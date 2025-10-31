import type { PageServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';

export const load: PageServerLoad = async ({ locals: { supabase } }) => {
	const {
		data: { user },
		error: userError
	} = await supabase.auth.getUser();

	// レイアウトでチェック済みですが、念のための防壁として残します
	if (userError || !user) {
		throw redirect(303, '/login');
	}

	// ログインユーザーが参加しているセッションの情報を取得（終了済みも含む）
	const { data: sessions, error } = await supabase
		.from('session_participants')
		.select('sessions!inner (id, name, session_date, join_code, is_active, is_tournament_mode)')
		.eq('user_id', user.id);

	if (error) {
		console.error('Error fetching sessions:', error);
		return { sessions: [], profile: null };
	}

	// ユーザーのプロフィール情報を取得
	const { data: profile } = await supabase
		.from('profiles')
		.select('full_name')
		.eq('id', user.id)
		.single();

	return {
		sessions: sessions.map((item: any) => item.sessions),
		profile
	};
};
