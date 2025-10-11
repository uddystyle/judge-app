import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals: { supabase, getSession } }) => {
	const session = await getSession();
	if (!session) {
		throw redirect(303, '/login');
	}

	// URLの[id]部分を取得
	const sessionId = params.id;

	// 選択されたセッションの詳細情報を取得
	const { data: sessionDetails } = await supabase
		.from('sessions')
		.select('*')
		.eq('id', sessionId)
		.single(); // 1件だけ取得

	if (!sessionDetails) {
		// もし存在しないセッションIDなら404エラーを表示
		throw error(404, '検定が見つかりません');
	}

	// 選択肢となる種別の一覧をeventsテーブルから取得 (重複を削除)
	const { data: events, error: eventsError } = await supabase.from('events').select('discipline');

	if (eventsError) {
		throw error(500, '種別情報の取得に失敗しました');
	}

	// disciplineの重複をなくして配列にする (例: ['プライズ', '級別'])
	const disciplines = [...new Set(events.map((e) => e.discipline))];

	// ページにセッション詳細と種別リストを渡す
	return {
		sessionDetails,
		disciplines
	};
};
