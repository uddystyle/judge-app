import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals: { supabase }, url }) => {
	const {
		data: { user },
		error: userError
	} = await supabase.auth.getUser();

	// URLからセッションID、種別、級を取得
	const { id: sessionId, discipline, level } = params;
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
		return { eventNames: [] };
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

	// プロフィールと組織情報を取得（認証ユーザーの場合のみ）
	let profile = null;
	let organizations = [];

	if (user) {
		const { data: profileData } = await supabase
			.from('profiles')
			.select('*')
			.eq('id', user.id)
			.single();

		profile = profileData;

		const { data: orgData } = await supabase
			.from('organization_members')
			.select('organization_id, organizations(id, name)')
			.eq('user_id', user.id);

		organizations = orgData || [];
	}

	// ページに種目リストを渡す
	return {
		eventNames,
		sessionDetails,
		user,
		guestIdentifier,
		guestParticipant,
		profile,
		organizations
	};
};
