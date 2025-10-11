import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals: { supabase, getSession } }) => {
	const session = await getSession();
	if (!session) {
		throw redirect(303, '/login');
	}

	const { id: sessionId, discipline } = params;

	const { data: events, error: eventsError } = await supabase
		.from('events')
		.select('level')
		.eq('discipline', discipline);

	if (eventsError) {
		throw error(500, '級情報の取得に失敗しました');
	}

	const levels = [...new Set(events.map((e) => e.level))].sort((a, b) => {
		// 全角数字を半角に変換してソート
		const numA = parseInt(
			// VVV This is the fix VVV
			a.replace(/[０-９]/g, (s: string) => String.fromCharCode(s.charCodeAt(0) - 0xfee0))
		);
		const numB = parseInt(
			// VVV This is the fix VVV
			b.replace(/[０-９]/g, (s: string) => String.fromCharCode(s.charCodeAt(0) - 0xfee0))
		);
		return numA - numB;
	});

	return {
		levels
	};
};
