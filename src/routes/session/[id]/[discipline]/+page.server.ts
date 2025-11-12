import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals: { supabase }, url }) => {
	const {
		data: { user },
		error: userError
	} = await supabase.auth.getUser();

	const { id: sessionId, discipline } = params;
	const guestIdentifier = url.searchParams.get('guest');

	// ゲストユーザーの情報を保持
	let guestParticipant = null;

	// ゲストユーザーの場合
	if (!user && guestIdentifier) {
		// ゲスト参加者情報を検証
		const { data: guestData, error: guestError } = await supabase
			.from('session_participants')
			.select('*')
			.eq('session_id', sessionId)
			.eq('guest_identifier', guestIdentifier)
			.eq('is_guest', true)
			.single();

		if (guestError || !guestData) {
			throw redirect(303, '/session/join');
		}

		guestParticipant = guestData;
	} else if (userError || !user) {
		throw redirect(303, '/login');
	}

	// 得点入力ページへのアクセスの場合は権限チェックをスキップ
	// （一般検定員も得点入力ページにはアクセスできる必要がある）
	if (url.pathname.includes('/score')) {
		return { levels: [] };
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

	return {
		levels,
		user,
		guestIdentifier,
		guestParticipant
	};
};
