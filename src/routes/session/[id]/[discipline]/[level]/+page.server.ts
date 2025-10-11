import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals: { supabase, getSession } }) => {
	const session = await getSession();
	if (!session) {
		throw redirect(303, '/login');
	}

	// URLからセッションID、種別、級を取得
	const { id: sessionId, discipline, level } = params;

	// 該当する種目の一覧をeventsテーブルから取得
	const { data: events, error: eventsError } = await supabase
		.from('events')
		.select('name')
		.eq('discipline', discipline)
		.eq('level', level);

	if (eventsError) {
		throw error(500, '種目情報の取得に失敗しました');
	}

	// nameの配列にする (例: ['不整地小回り', '総合滑降'])
	const eventNames = events.map((e) => e.name);

	// ページに種目リストを渡す
	return {
		eventNames
	};
};
