import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { checkCanAddJudgeToSession } from '$lib/server/organizationLimits';

export const load: PageServerLoad = async ({ params, locals: { supabase } }) => {
	const token = params.token;

	// トークンからセッション情報を取得
	const { data: session, error } = await supabase
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
		console.error('[Guest Invite] Error fetching session:', error);
		console.log('[Guest Invite] Token:', token);
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
	join: async ({ request, params, locals: { supabase } }) => {
		const token = params.token;
		const formData = await request.formData();
		const guestName = formData.get('guestName')?.toString();

		if (!guestName || guestName.trim().length === 0) {
			return fail(400, {
				error: '名前を入力してください。'
			});
		}

		// トークンからセッション情報を取得
		const { data: session, error: sessionError } = await supabase
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
		const limitCheck = await checkCanAddJudgeToSession(supabase, session.id);
		if (!limitCheck.allowed) {
			return fail(400, {
				error: limitCheck.reason || 'セッションに参加できません。',
				upgradeUrl: limitCheck.upgradeUrl
			});
		}

		// ゲスト識別子を生成
		const guestIdentifier = crypto.randomUUID();

		// session_participants に登録
		const { error: insertError } = await supabase.from('session_participants').insert({
			session_id: session.id,
			is_guest: true,
			guest_name: guestName.trim(),
			guest_identifier: guestIdentifier
		});

		if (insertError) {
			console.error('[Guest Join] Error inserting participant:', insertError);
			return fail(500, {
				error: 'セッションへの参加に失敗しました。'
			});
		}

		// セッションページへリダイレクト（guest識別子をパラメータに含める）
		throw redirect(303, `/session/${session.id}?guest=${guestIdentifier}`);
	}
};
