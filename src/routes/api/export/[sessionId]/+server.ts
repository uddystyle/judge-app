import { json, redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, locals: { supabase } }) => {
	const {
		data: { user },
		error: userError
	} = await supabase.auth.getUser();

	// Only logged-in users can export data
	if (userError || !user) {
		throw redirect(303, '/login');
	}

	const { sessionId } = params;

	// Fetch all results for the given session ID from the 'results' table
	const { data, error } = await supabase
		.from('results')
		.select('created_at, bib, score, discipline, level, event_name, judge_name')
		.eq('session_id', sessionId)
		.order('created_at', { ascending: true }); // Order by time

	if (error) {
		return json({ error: '結果の取得に失敗しました。' }, { status: 500 });
	}

	// Return the data as a JSON response
	return json({ results: data });
};
