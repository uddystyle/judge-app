import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { checkCanAddJudgeToSession } from '$lib/server/organizationLimits';
import { validateName } from '$lib/server/validation';
import { isJudgeNameTakenInSession } from '$lib/server/sessionHelpers';
import { logger } from '$lib/server/logger';

export const load: PageServerLoad = async ({ params, locals: { supabase, supabaseAdmin } }) => {
	const token = params.token;

	// anon の sessions 全読み（invite_token 漏洩）を塞いだため、トークン照合は service role で行う。
	if (!supabaseAdmin) {
		logger.error(
			'[Guest Invite] supabaseAdmin が利用できません（SUPABASE_SERVICE_ROLE_KEY 未設定）'
		);
		return { error: 'サーバー設定エラーにより招待ページを表示できません。', session: null };
	}

	// トークンからセッション情報を取得
	const { data: session, error } = await supabaseAdmin
		.from('sessions')
		.select(
			`
			id,
			name,
			mode,
			is_tournament_mode,
			organization_id,
			organizations (
				name
			)
		`
		)
		.eq('invite_token', token)
		.single();

	if (error || !session) {
		logger.error('[Guest Invite] Error fetching session:', error);
		logger.debug('[Guest Invite] Token:', token);
		return {
			error: `招待リンクが無効です。${error ? ` (${error.message})` : ''}`,
			session: null
		};
	}

	// 既にログインしているユーザーの場合
	const {
		data: { user }
	} = await supabase.auth.getUser();

	if (user) {
		// 既に参加しているかチェック
		const { data: existingParticipant } = await supabase
			.from('session_participants')
			.select('id')
			.eq('session_id', session.id)
			.eq('user_id', user.id)
			.maybeSingle();

		if (existingParticipant) {
			// 既に参加済み - セッションページへリダイレクト
			throw redirect(303, `/session/${session.id}`);
		}
	}

	return {
		session,
		token
	};
};

export const actions: Actions = {
	join: async ({ request, params, locals: { supabase, supabaseAdmin } }) => {
		const token = params.token;
		const formData = await request.formData();
		const guestName = formData.get('guestName')?.toString();

		// signup と同じく validateName でサニタイズ（XSS対策・長さ上限100・前後空白除去）
		const nameValidation = validateName(guestName);
		if (!nameValidation.valid) {
			return fail(400, {
				error: nameValidation.error || '名前を入力してください。'
			});
		}
		const sanitizedGuestName = nameValidation.sanitized!;

		// anon の sessions 全読み（invite_token 漏洩）を塞いだため、トークン照合は service role で行う。
		if (!supabaseAdmin) {
			logger.error(
				'[Guest Invite] supabaseAdmin が利用できません（SUPABASE_SERVICE_ROLE_KEY 未設定）'
			);
			return fail(500, {
				error: 'サーバー設定エラーにより参加できませんでした。管理者に連絡してください。'
			});
		}

		// トークンからセッション情報を取得
		const { data: session, error: sessionError } = await supabaseAdmin
			.from('sessions')
			.select('id, organization_id')
			.eq('invite_token', token)
			.single();

		if (sessionError || !session) {
			return fail(400, {
				error: '招待リンクが無効です。'
			});
		}

		// 検定員数制限チェック
		const limitCheck = await checkCanAddJudgeToSession(supabaseAdmin, session.id);
		if (!limitCheck.allowed) {
			return fail(400, {
				error: limitCheck.reason || 'セッションに参加できません。',
				upgradeUrl: limitCheck.upgradeUrl
			});
		}

		// ゲスト登録は RLS をバイパスする service role で実行する（migration 1002 で
		// anon からの session_participants 直接INSERTを禁止したため）。
		if (!supabaseAdmin) {
			logger.error(
				'[Guest Invite] supabaseAdmin が利用できません（SUPABASE_SERVICE_ROLE_KEY 未設定）'
			);
			return fail(500, {
				error: 'サーバー設定エラーにより参加できませんでした。管理者に連絡してください。'
			});
		}

		// 同名の検定員がいると results が judge_name で衝突し上書きされるため、
		// セッション内で表示名を一意化する（#7 暫定・アプリ側）。
		if (await isJudgeNameTakenInSession(supabaseAdmin, session.id, sanitizedGuestName)) {
			return fail(409, {
				error: 'この名前は既にこの検定で使われています。別の名前を入力してください。'
			});
		}

		// ゲスト識別子を生成
		const guestIdentifier = crypto.randomUUID();

		// Step 1: session_participants に登録（service role）
		const { error: insertError } = await supabaseAdmin.from('session_participants').insert({
			session_id: session.id,
			is_guest: true,
			guest_name: sanitizedGuestName,
			guest_identifier: guestIdentifier
		});

		if (insertError) {
			logger.error('[Guest Join] Error inserting participant:', insertError);
			return fail(500, {
				error: 'セッションへの参加に失敗しました。'
			});
		}

		// Step 2: Supabase Anonymous Authでゲスト用JWTを発行
		logger.debug('[Guest Invite] ゲスト用JWT発行開始:', { guestIdentifier });
		const { data: authData, error: authError } = await supabase.auth.signInAnonymously({
			options: {
				data: {
					session_id: session.id,
					guest_identifier: guestIdentifier,
					guest_name: sanitizedGuestName,
					is_guest: true
				}
			}
		});

		if (authError || !authData.session) {
			logger.error('[Guest Invite] JWT発行エラー:', authError);

			// ⚠️ CRITICAL: JWT発行失敗時は session_participants レコードをロールバック
			logger.debug('[Guest Invite] JWT発行失敗のため、参加者レコードをロールバック中...');
			const { error: rollbackError } = await supabaseAdmin
				.from('session_participants')
				.delete()
				.eq('guest_identifier', guestIdentifier);

			if (rollbackError) {
				logger.error('[Guest Invite] ロールバック失敗:', rollbackError);
				// ロールバック失敗でも、ユーザーには認証失敗として通知
			} else {
				logger.debug('[Guest Invite] ロールバック成功');
			}

			return fail(500, {
				error: '認証に失敗しました。再度お試しください。'
			});
		}

		logger.debug(
			'[Guest Invite] ゲスト参加成功。JWT発行完了。リダイレクト先:',
			`/session/${session.id}`
		);
		// Step 3: セッションページへリダイレクト（JWTがcookieに保存される）
		throw redirect(303, `/session/${session.id}`);
	}
};
