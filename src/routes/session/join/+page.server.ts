import { fail, redirect } from '@sveltejs/kit';
import type { Actions } from './$types';
import { checkCanAddJudgeToSession } from '$lib/server/organizationLimits';
import { rateLimiters, checkRateLimit } from '$lib/server/rateLimit';
import { validateName } from '$lib/server/validation';
import { isJudgeNameTakenInSession } from '$lib/server/sessionHelpers';

export const actions: Actions = {
	// 'join'アクションは、フォームが送信されたときに呼び出される
	join: async ({ request, locals: { supabase, supabaseAdmin } }) => {
		// レート制限は「失敗（誤コード）」のみ IP 単位で計上する（下の 404 分岐）。
		// 会場では多数の参加者が同一 NAT IP を共有するため、成功 join を一律に縛ると
		// 6人目以降が 429 になり一斉参加が破綻する。正しいコードでの join は制限しない。

		const {
			data: { user },
			error: userError
		} = await supabase.auth.getUser();

		const formData = await request.formData();
		const joinCode = (formData.get('joinCode') as string)?.trim().toUpperCase();
		const guestName = formData.get('guestName') as string;
		const isGuestMode = formData.get('isGuest') === 'true';

		// ゲストモードの場合は名前が必須、認証ユーザーの場合はユーザー情報が必須
		let sanitizedGuestName = '';
		if (isGuestMode) {
			// signup と同じく validateName でサニタイズ（XSS対策・長さ上限100・前後空白除去）
			const nameValidation = validateName(guestName);
			if (!nameValidation.valid) {
				return fail(400, { joinCode, guestName, error: nameValidation.error });
			}
			sanitizedGuestName = nameValidation.sanitized!;
		} else {
			if (userError || !user) {
				throw redirect(303, '/login');
			}
		}

		// バリデーション
		if (!joinCode) {
			return fail(400, { joinCode: '', guestName, error: '参加コードを入力してください。' });
		}

		if (joinCode.length !== 8) {
			return fail(400, { joinCode, guestName, error: '参加コードは8桁です。' });
		}

		// 英数字のみ許可
		if (!/^[A-Z0-9]{8}$/.test(joinCode)) {
			return fail(400, { joinCode, guestName, error: '参加コードは英数字8桁で入力してください。' });
		}

		// 以降の sessions 参照は RLS をバイパスする service role で行う。
		// anon の sessions 全読み（join_code 漏洩）を塞いだため、join 時点（呼び出し元はまだ非メンバー）の
		// 参加コード照合は anon クライアントでは読めない。
		if (!supabaseAdmin) {
			console.error(
				'[Join Session] supabaseAdmin が利用できません（SUPABASE_SERVICE_ROLE_KEY 未設定）'
			);
			return fail(500, {
				joinCode,
				error: 'サーバー設定エラーにより参加できませんでした。管理者に連絡してください。'
			});
		}

		// 参加コードに一致するセッションをデータベースから検索
		console.log('[Join Session] 参加コードでセッション検索:', joinCode);
		const { data: sessionData, error: sessionError } = await supabaseAdmin
			.from('sessions')
			.select('id, is_accepting_participants, organization_id, is_locked')
			.eq('join_code', joinCode)
			.maybeSingle();

		console.log('[Join Session] セッション検索結果:', { sessionData, error: sessionError });

		if (sessionError) {
			console.error('[Join Session] セッション検索エラー:', sessionError);
			return fail(500, { joinCode, error: 'セッションの検索に失敗しました。' });
		}

		if (!sessionData) {
			// 誤コード（総当たりの兆候）のみ IP 単位でレート制限。閾値超過で 429。
			const rl = await checkRateLimit(request, rateLimiters?.joinFail);
			if (!rl.success) {
				return rl.response;
			}
			console.log('[Join Session] 参加コードに一致するセッションが見つかりません');
			return fail(404, { joinCode, error: '無効な参加コードです。' });
		}

		// セッションがロックされているかチェック
		if (sessionData.is_locked) {
			console.log('[Join Session] ロックされたセッションへのアクセス試行:', {
				sessionId: sessionData.id
			});
			return fail(423, {
				joinCode,
				guestName,
				error: '不正なアクセスが検出されたため、このセッションはロックされました。'
			});
		}

		// セッションが参加受付中かチェック
		if (!sessionData.is_accepting_participants) {
			return fail(400, {
				joinCode,
				guestName,
				error: 'このセッションは参加受付を終了しています。'
			});
		}

		// 検定員数制限チェック（ゲスト・認証ユーザー共通）
		// ゲストも session_participants に検定員として登録されカウント対象になるため、
		// ゲスト参加でも有料プランの検定員上限を回避できないよう必ずチェックする
		console.log('[Join Session] 検定員数制限チェック開始:', {
			sessionId: sessionData.id,
			organizationId: sessionData.organization_id,
			isGuestMode
		});
		const judgeCheck = await checkCanAddJudgeToSession(supabaseAdmin, sessionData.id);
		console.log('[Join Session] 検定員数制限チェック結果:', judgeCheck);

		if (!judgeCheck.allowed) {
			console.log('[Join Session] 検定員数制限により参加拒否:', judgeCheck.reason);
			return fail(403, {
				joinCode,
				guestName,
				error: judgeCheck.reason || 'セッションの検定員数上限に達しています。',
				upgradeUrl: judgeCheck.upgradeUrl
			});
		}

		// ゲストユーザーの場合
		if (isGuestMode) {
			console.log('[Join Session] ゲストとして参加:', {
				sessionId: sessionData.id,
				guestName: guestName.trim()
			});

			// ゲスト登録は RLS をバイパスする service role で実行する。
			// anon キーからの session_participants への直接INSERTはRLSで禁止し
			// （migration 1002）、ロック/受付終了/検定員上限などサーバ側チェックを
			// 通過した後にのみサーバ側で登録することで、公開anonキーによる
			// 任意セッションへの参加者注入を防ぐ。
			if (!supabaseAdmin) {
				console.error(
					'[Join Session] supabaseAdmin が利用できません（SUPABASE_SERVICE_ROLE_KEY 未設定）'
				);
				return fail(500, {
					joinCode,
					guestName,
					error: 'サーバー設定エラーにより参加できませんでした。管理者に連絡してください。'
				});
			}

			// 同名の検定員がいると results が judge_name で衝突し上書きされるため、
			// セッション内で表示名を一意化する（#7 暫定・アプリ側）。
			if (await isJudgeNameTakenInSession(supabaseAdmin, sessionData.id, sanitizedGuestName)) {
				return fail(409, {
					joinCode,
					guestName,
					error: 'この名前は既にこの検定で使われています。別の名前を入力してください。'
				});
			}

			const guestIdentifier = crypto.randomUUID();

			// Step 1: session_participantsに登録（service role）
			const { error: insertError } = await supabaseAdmin.from('session_participants').insert({
				session_id: sessionData.id,
				is_guest: true,
				guest_name: sanitizedGuestName,
				guest_identifier: guestIdentifier
			});

			if (insertError) {
				console.error('[Join Session] ゲスト参加者追加エラー:', insertError);
				return fail(500, {
					joinCode,
					guestName,
					error: '検定への参加に失敗しました。'
				});
			}

			// Step 2: Supabase Anonymous Authでゲスト用JWTを発行
			console.log('[Join Session] ゲスト用JWT発行開始:', { guestIdentifier });
			const { data: authData, error: authError } = await supabase.auth.signInAnonymously({
				options: {
					data: {
						session_id: sessionData.id,
						guest_identifier: guestIdentifier,
						guest_name: sanitizedGuestName,
						is_guest: true
					}
				}
			});

			if (authError || !authData.session) {
				console.error('[Join Session] JWT発行エラー:', authError);

				// ⚠️ CRITICAL: JWT発行失敗時は session_participants レコードをロールバック
				console.log('[Join Session] JWT発行失敗のため、参加者レコードをロールバック中...');
				const { error: rollbackError } = await supabaseAdmin
					.from('session_participants')
					.delete()
					.eq('guest_identifier', guestIdentifier);

				if (rollbackError) {
					console.error('[Join Session] ロールバック失敗:', rollbackError);
					// ロールバック失敗でも、ユーザーには認証失敗として通知
				} else {
					console.log('[Join Session] ロールバック成功');
				}

				return fail(500, {
					joinCode,
					guestName,
					error: '認証に失敗しました。再度お試しください。'
				});
			}

			console.log(
				'[Join Session] ゲスト参加成功。JWT発行完了。リダイレクト先:',
				`/session/${sessionData.id}`
			);
			// Step 3: URLパラメータなしでリダイレクト（JWTがcookieに保存される）
			throw redirect(303, `/session/${sessionData.id}`);
		}

		// 認証ユーザーの場合
		console.log('[Join Session] 参加者追加を実行:', {
			sessionId: sessionData.id,
			userId: user.id
		});

		const { error: joinError } = await supabase.from('session_participants').insert({
			session_id: sessionData.id,
			user_id: user.id
		});

		console.log('[Join Session] 参加者追加結果:', { error: joinError });

		// 23505はunique_violationエラー（既にメンバーである場合）。
		// このエラーは無視して成功とみなす。それ以外のエラーは失敗として処理。
		if (joinError && joinError.code !== '23505') {
			console.error('[Join Session] 参加者追加エラー:', joinError);
			return fail(500, {
				joinCode,
				guestName,
				error: '検定への参加に失敗しました。'
			});
		}

		console.log('[Join Session] 参加成功。リダイレクト先:', `/session/${sessionData.id}`);
		// 成功したら、セッション待機画面へリダイレクト
		throw redirect(303, `/session/${sessionData.id}`);
	}
};
