import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, url, locals: { supabase } }) => {
	const { id: sessionId } = params;
	const guestIdentifier = url.searchParams.get('guest');

	const {
		data: { user },
		error: userError
	} = await supabase.auth.getUser();

	// ゲストユーザーの情報を保持
	let guestParticipant = null;

	// ゲストユーザーの場合
	if (!user && guestIdentifier) {
		// ゲスト参加者情報を取得して検証
		const { data: guestData, error: guestError } = await supabase
			.from('session_participants')
			.select('*')
			.eq('session_id', sessionId)
			.eq('guest_identifier', guestIdentifier)
			.eq('is_guest', true)
			.single();

		if (guestError || !guestData) {
			// ゲスト情報が見つからない場合は招待ページへリダイレクト
			throw redirect(303, '/session/join');
		}

		guestParticipant = guestData;
	}

	// 通常ユーザーでログインしていない場合はログインページへ
	if (!user && !guestIdentifier) {
		throw redirect(303, '/login');
	}

	// セッション情報を取得
	const { data: sessionDetails, error: sessionError } = await supabase
		.from('sessions')
		.select('*')
		.eq('id', sessionId)
		.single();

	if (sessionError) {
		throw error(404, 'セッションが見つかりません。');
	}

	// 研修モードでない場合はダッシュボードにリダイレクト
	if (sessionDetails.mode !== 'training') {
		throw redirect(303, '/dashboard');
	}

	// 研修種目の数を取得
	const { count: eventsCount } = await supabase
		.from('training_events')
		.select('*', { count: 'exact', head: true })
		.eq('session_id', sessionId);

	// 参加者の数を取得
	const { count: participantsCount } = await supabase
		.from('participants')
		.select('*', { count: 'exact', head: true })
		.eq('session_id', sessionId);

	// ユーザーのプロフィール情報を取得（ゲストの場合はスキップ）
	let profile = null;
	let hasOrganization = false;

	if (user) {
		const [profileResult, userOrgMembersResult] = await Promise.all([
			supabase
				.from('profiles')
				.select('full_name')
				.eq('id', user.id)
				.single(),
			supabase
				.from('organization_members')
				.select('organization_id')
				.eq('user_id', user.id)
				.is('removed_at', null)
		]);

		profile = profileResult.data;
		const userOrgMembers = userOrgMembersResult.data || [];
		hasOrganization = userOrgMembers.length > 0;
	}

	return {
		user,
		profile,
		hasOrganization,
		sessionDetails,
		eventsCount: eventsCount || 0,
		participantsCount: participantsCount || 0,
		guestIdentifier,
		guestParticipant
	};
};
