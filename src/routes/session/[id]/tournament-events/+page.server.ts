import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { authenticateSession } from '$lib/server/sessionAuth';

export const load: PageServerLoad = async ({ params, url, locals: { supabase } }) => {
	const { id: sessionId } = params;
	const guestIdentifier = url.searchParams.get('guest');

	// セッション認証
	const { user, guestParticipant } = await authenticateSession(
		supabase,
		sessionId,
		guestIdentifier
	);

	// セッション情報を取得
	const { data: sessionDetails, error: sessionError } = await supabase
		.from('sessions')
		.select('*')
		.eq('id', sessionId)
		.single();

	if (sessionError) {
		throw error(404, '検定が見つかりません。');
	}

	// 大会モードでない場合はエラー
	if (!sessionDetails.is_tournament_mode) {
		throw redirect(303, `/session/${sessionId}`);
	}

	// 主任検定員判定（ゲストは主任検定員になれない）
	const isChief = user ? user.id === sessionDetails.chief_judge_id : false;

	// 大会モードでは常に主任検定員のみが種目選択可能
	// （is_multi_judge の状態に関わらず、主任検定員が採点指示を出す）
	if (guestParticipant) {
		// ゲストユーザーは種目選択できない
		throw error(
			403,
			'大会モードでは主任検定員が採点指示を出します。待機画面でお待ちください。'
		);
	} else if (!isChief) {
		// 一般検定員も種目選択できない
		throw error(403, '種目を選択する権限がありません。主任検定員の指示をお待ちください。');
	}

	// カスタム種目の一覧を取得
	const { data: customEvents, error: eventsError } = await supabase
		.from('custom_events')
		.select('*')
		.eq('session_id', sessionId)
		.order('display_order', { ascending: true });

	if (eventsError) {
		console.error('Error fetching custom events:', eventsError);
		throw error(500, 'カスタム種目の取得に失敗しました。');
	}

	// カスタム種目が未登録の場合は設定画面へ
	if (!customEvents || customEvents.length === 0) {
		throw redirect(303, `/session/${sessionId}/tournament-setup/events`);
	}

	// プロフィール情報を取得
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
		user,
		profile,
		sessionDetails,
		customEvents,
		isChief,
		isMultiJudge: sessionDetails.is_multi_judge || false,
		guestParticipant,
		guestIdentifier
	};
};
