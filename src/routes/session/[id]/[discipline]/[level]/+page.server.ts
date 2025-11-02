import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals: { supabase }, url }) => {
	const {
		data: { user },
		error: userError
	} = await supabase.auth.getUser();

	if (userError || !user) {
		throw redirect(303, '/login');
	}

	// URLからセッションID、種別、級を取得
	const { id: sessionId, discipline, level } = params;

	// 得点入力ページへのアクセスの場合は権限チェックをスキップ
	// （一般検定員も得点入力ページにはアクセスできる必要がある）
	if (url.pathname.includes('/score')) {
		return { eventNames: [] };
	}

	// セッション情報を取得して、主任検定員かどうかを確認
	const { data: sessionDetails, error: sessionError } = await supabase
		.from('sessions')
		.select('chief_judge_id, is_multi_judge')
		.eq('id', sessionId)
		.single();

	if (sessionError) {
		throw error(404, '検定が見つかりません。');
	}

	// 一般検定員の場合、複数検定員モードONならセッション詳細ページ（待機画面）にリダイレクト
	// 複数検定員モードOFFの場合は、一般検定員もアクセス可能
	const isChief = user.id === sessionDetails.chief_judge_id;
	if (!isChief && sessionDetails.is_multi_judge) {
		throw redirect(303, `/session/${sessionId}`);
	}

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
