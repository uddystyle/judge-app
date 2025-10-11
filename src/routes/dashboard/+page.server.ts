// import { redirect } from '@sveltejs/kit';
// import type { PageServerLoad } from './$types';

// export const load: PageServerLoad = async ({ locals: { supabase, getSession } }) => {
// 	const session = await getSession();

// 	if (!session) {
// 		throw redirect(303, '/login');
// 	}

// 	const { data: sessions, error } = await supabase
// 		.from('session_participants')
// 		.select('sessions (id, name, session_date, join_code)')
// 		.eq('user_id', session.user.id);

// 	if (error) {
// 		console.error('Error fetching sessions:', error);
// 		return { sessions: [] };
// 	}

// 	// `item`に型注釈を追加してエラーを解消
// 	return { sessions: sessions.map((item: any) => item.sessions) };
// };

import type { PageServerLoad } from './$types';
import { redirect } from '@sveltejs/kit'; // redirectは念のため残します

export const load: PageServerLoad = async ({ locals: { supabase, getSession } }) => {
	const session = await getSession();

	// レイアウトでチェック済みですが、念のための防壁として残します
	if (!session) {
		throw redirect(303, '/login');
	}

	// ログインユーザーが参加しているセッションの情報を取得
	const { data: sessions, error } = await supabase
		.from('session_participants')
		.select('sessions (id, name, session_date, join_code)')
		.eq('user_id', session.user.id);

	if (error) {
		console.error('Error fetching sessions:', error);
		return { sessions: [] };
	}

	return { sessions: sessions.map((item: any) => item.sessions) };
};
