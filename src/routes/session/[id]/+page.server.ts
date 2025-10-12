import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals: { supabase, getSession } }) => {
	const session = await getSession();
	if (!session) {
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

	const { data: events, error: eventsError } = await supabase.from('events').select('discipline');

	if (eventsError) {
		throw error(500, '種別情報の取得に失敗しました。');
	}

	const disciplines = [...new Set(events.map((e) => e.discipline))];

	return {
		disciplines,
		sessionDetails
	};
};
