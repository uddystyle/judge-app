import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { authenticateSession } from '$lib/server/sessionAuth';

export const load: PageServerLoad = async ({ params, url, locals: { supabase } }) => {
	const sessionId = params.id;
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

	if (sessionError || !sessionDetails) {
		throw error(404, '検定が見つかりません。');
	}

	// 研修モード以外は404
	if (sessionDetails.mode !== 'training') {
		throw error(404, 'このページは研修モード専用です。');
	}

	// 研修セッション情報を取得
	const { data: trainingSession } = await supabase
		.from('training_sessions')
		.select('*')
		.eq('session_id', sessionId)
		.maybeSingle();

	// 主任検定員判定（ゲストは主任検定員になれない）
	const isChief = user ? user.id === sessionDetails.chief_judge_id : false;

	// 複数検定員モードの場合、主任検定員のみアクセス可能
	if (trainingSession?.is_multi_judge) {
		if (guestParticipant) {
			// ゲストユーザーは複数検定員モードで種目選択できない
			throw error(
				403,
				'複数検定員モードでは主任検定員が採点指示を出します。待機画面でお待ちください。'
			);
		} else if (!isChief) {
			// 一般検定員も種目選択できない
			throw error(403, '種目を選択する権限がありません。');
		}
	}

	// 参加者であることを確認（フリーモードの場合）
	// ただし、主任検定員の場合は参加者チェックをスキップ
	if (!trainingSession?.is_multi_judge && !isChief) {
		if (guestParticipant) {
			// ゲストユーザーは既に参加者として確認済み
			// フリーモードでは種目選択可能
		} else {
			// 認証ユーザーの参加者チェック
			const { data: participant } = await supabase
				.from('session_participants')
				.select('user_id')
				.eq('session_id', sessionId)
				.eq('user_id', user.id)
				.maybeSingle();

			if (!participant) {
				throw error(403, 'このセッションの参加者ではありません。');
			}
		}
	}

	// 研修種目を取得
	const { data: events, error: eventsError } = await supabase
		.from('training_events')
		.select('*')
		.eq('session_id', sessionId)
		.order('order_index', { ascending: true });

	if (eventsError) {
		throw error(500, '種目情報の取得に失敗しました。');
	}

	return {
		sessionDetails,
		trainingSession,
		events: events || [],
		isChief,
		isMultiJudge: trainingSession?.is_multi_judge || false,
		user,
		guestParticipant,
		guestIdentifier
	};
};
