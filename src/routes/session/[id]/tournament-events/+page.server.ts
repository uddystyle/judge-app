import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals: { supabase } }) => {
	const {
		data: { user },
		error: userError
	} = await supabase.auth.getUser();

	if (userError || !user) {
		throw redirect(303, '/login');
	}

	const { id: sessionId } = params;

	// セッション情報を取得
	const { data: sessionDetails, error: sessionError } = await supabase
		.from('sessions')
		.select('*')
		.eq('id', sessionId)
		.single();

	if (sessionError) {
		throw error(404, '検定が見つかりません。');
	}

	// 大会モードでない場合はエラー
	if (!sessionDetails.is_tournament_mode) {
		throw redirect(303, `/session/${sessionId}`);
	}

	// 主任検定員のみアクセス可能
	if (user.id !== sessionDetails.chief_judge_id) {
		throw redirect(303, `/session/${sessionId}`);
	}

	// カスタム種目の一覧を取得
	const { data: customEvents, error: eventsError } = await supabase
		.from('custom_events')
		.select('*')
		.eq('session_id', sessionId)
		.order('display_order', { ascending: true });

	if (eventsError) {
		console.error('Error fetching custom events:', eventsError);
		throw error(500, 'カスタム種目の取得に失敗しました。');
	}

	// カスタム種目が未登録の場合は設定画面へ
	if (!customEvents || customEvents.length === 0) {
		throw redirect(303, `/session/${sessionId}/tournament-setup/events`);
	}

	// プロフィールと組織情報を取得
	let profile = null;
	let organizations = [];

	if (user) {
		const { data: profileData } = await supabase
			.from('profiles')
			.select('*')
			.eq('id', user.id)
			.single();

		profile = profileData;

		const { data: orgData } = await supabase
			.from('organization_members')
			.select('organization_id, organizations(id, name)')
			.eq('user_id', user.id);

		organizations = orgData || [];
	}

	return {
		user,
		profile,
		organizations,
		sessionDetails,
		customEvents
	};
};
