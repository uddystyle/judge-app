import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals: { supabase, getSession } }) => {
	const session = await getSession();
	if (!session) {
		throw redirect(303, '/login');
	}

	// 現在のユーザーのプロフィール情報（氏名）を取得
	const { data: profile } = await supabase
		.from('profiles')
		.select('full_name')
		.eq('id', session.user.id)
		.single();

	// 取得したプロフィール情報をページに渡す
	return { profile };
};
