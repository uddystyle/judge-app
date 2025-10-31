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

	const sessionId = params.id;

	// セッションの詳細情報を取得
	const { data: sessionDetails, error: sessionError } = await supabase
		.from('sessions')
		.select('*')
		.eq('id', sessionId)
		.single();

	if (sessionError) {
		throw error(404, '検定が見つかりません。');
	}

	// ログイン中のユーザーが主任検定員かどうかを判定
	const isChief = user.id === sessionDetails.chief_judge_id;

	// 大会モードの場合
	if (sessionDetails.is_tournament_mode && isChief) {
		// カスタム種目の数を取得
		const { count: eventsCount } = await supabase
			.from('custom_events')
			.select('*', { count: 'exact', head: true })
			.eq('session_id', sessionId);

		return {
			isChief,
			sessionDetails,
			isTournamentMode: true,
			hasEvents: (eventsCount || 0) > 0,
			isSessionActive: sessionDetails.is_active
		};
	}

	// もし主任検定員なら、種別選択に必要なデータを取得
	if (isChief) {
		const { data: events, error: eventsError } = await supabase.from('events').select('discipline');

		if (eventsError) {
			throw error(500, '種別情報の取得に失敗しました。');
		}

		const disciplines = [...new Set(events.map((e) => e.discipline))];

		return {
			isChief,
			sessionDetails,
			disciplines,
			isTournamentMode: false,
			isSessionActive: sessionDetails.is_active
		};
	}

	// 一般の検定員の場合は、待機画面を表示するための情報だけを渡す
	return {
		isChief,
		sessionDetails,
		isTournamentMode: sessionDetails.is_tournament_mode,
		isSessionActive: sessionDetails.is_active
	};
};
