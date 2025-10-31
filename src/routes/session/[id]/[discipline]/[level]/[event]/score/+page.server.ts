import { redirect } from '@sveltejs/kit';
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

	// セッション情報を取得して、主任検定員かどうかを確認
	const { data: sessionDetails, error: sessionError } = await supabase
		.from('sessions')
		.select('chief_judge_id, is_multi_judge')
		.eq('id', sessionId)
		.single();

	if (sessionError) {
		console.error('Failed to fetch session details:', sessionError);
		return {
			isChief: false,
			isMultiJudge: false
		};
	}

	const isChief = user.id === sessionDetails.chief_judge_id;

	return {
		isChief,
		isMultiJudge: sessionDetails.is_multi_judge
	};
};
