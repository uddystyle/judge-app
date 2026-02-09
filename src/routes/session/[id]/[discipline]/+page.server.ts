import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { authenticateSession } from '$lib/server/sessionAuth';

export const load: PageServerLoad = async ({ params, locals: { supabase }, url }) => {
	const { id: sessionId, discipline } = params;
	const guestIdentifier = url.searchParams.get('guest');

	// セッション認証
	const { user, guestParticipant } = await authenticateSession(
		supabase,
		sessionId,
		guestIdentifier
	);

	// 得点入力ページへのアクセスの場合は権限チェックをスキップ
	// （一般検定員も得点入力ページにはアクセスできる必要がある）
	if (url.pathname.includes('/score')) {
		return { levels: [] };
	}

	// セッション情報を取得して、主任検定員かどうかを確認
	const { data: sessionDetails, error: sessionError } = await supabase
		.from('sessions')
		.select('id, name, chief_judge_id, is_multi_judge, session_date')
		.eq('id', sessionId)
		.single();

	if (sessionError) {
		throw error(404, '検定が見つかりません。');
	}

	// 一般検定員の場合、複数検定員モードONならセッション詳細ページ（待機画面）にリダイレクト
	// 複数検定員モードOFFの場合は、一般検定員もアクセス可能
	// ゲストユーザーは主任検定員ではない
	const isChief = user ? user.id === sessionDetails.chief_judge_id : false;
	if (!isChief && sessionDetails.is_multi_judge && !guestIdentifier) {
		throw redirect(303, `/session/${sessionId}`);
	} else if (!isChief && sessionDetails.is_multi_judge && guestIdentifier) {
		throw redirect(303, `/session/${sessionId}?guest=${guestIdentifier}`);
	}

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

	// プロフィール情報を取得（認証ユーザーの場合のみ）
	let profile = null;

	if (user) {
		const { data: profileData } = await supabase
			.from('profiles')
			.select('*')
			.eq('id', user.id)
			.single();

		profile = profileData;
	}

	return {
		levels,
		sessionDetails,
		user,
		guestIdentifier,
		guestParticipant,
		profile
	};
};
