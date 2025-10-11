import type { PageServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';

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
