import { error, redirect, fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { authenticateSession, authenticateAction } from '$lib/server/sessionAuth';
import {
	fetchSessionDetails,
	fetchUserProfile,
	isChiefJudge
} from '$lib/server/sessionHelpers';

export const load: PageServerLoad = async ({ params, url, locals: { supabase } }) => {
	const { id, discipline, level, event } = params;
	const bib = url.searchParams.get('bib');
	const averageScore = url.searchParams.get('score');
	const guestIdentifier = url.searchParams.get('guest');

	// セッション認証
	const { user, guestParticipant } = await authenticateSession(
		supabase,
		id,
		guestIdentifier
	);

	if (!bib) {
		throw error(400, 'ゼッケン番号が指定されていません。');
	}

	const sessionDetails = await fetchSessionDetails(supabase, id);
	const isChief = isChiefJudge(user, sessionDetails);
	const profile = await fetchUserProfile(supabase, user);

	// 全検定員の得点を取得
	const { data: scores, error: scoresError } = await supabase
		.from('results')
		.select('judge_name, score')
		.eq('session_id', id)
		.eq('bib', bib)
		.eq('discipline', discipline)
		.eq('level', level)
		.eq('event_name', event);

	if (scoresError) {
		console.error('Failed to fetch scores:', scoresError);
		throw error(500, '得点の取得に失敗しました。');
	}

	return {
		bib,
		averageScore,
		isMultiJudge: sessionDetails.is_multi_judge,
		scores: scores || [],
		isChief,
		isTournamentMode: sessionDetails.is_tournament_mode,
		sessionDetails,
		user,
		guestIdentifier,
		guestParticipant,
		profile
	};
};

export const actions: Actions = {
	changeEvent: async ({ params, locals: { supabase }, url }) => {
		const { id } = params;
		const guestIdentifier = url.searchParams.get('guest');

		// セッション認証
		const authResult = await authenticateAction(supabase, id, guestIdentifier);

		if (!authResult) {
			return fail(401, { error: '認証が必要です。' });
		}

		const { user } = authResult;

		const session = await fetchSessionDetails(supabase, id, { throwOnError: false });
		if (!session) {
			return fail(404, { error: '検定が見つかりません。' });
		}
		const isChief = isChiefJudge(user, session);

		// 主任検定員または複数検定員モードOFFの場合のみ実行可能
		if (!isChief && session.is_multi_judge) {
			return fail(403, { error: '種目を変更する権限がありません。' });
		}

		// active_prompt_idをクリア（一般検定員を待機画面に戻す）
		const { error: updateError } = await supabase
			.from('sessions')
			.update({ active_prompt_id: null })
			.eq('id', id);

		if (updateError) {
			return fail(500, { error: 'セッションの更新に失敗しました。' });
		}

		// 大会モードの場合は種目選択画面へ、検定モードも種目選択画面へ
		const guestParam = guestIdentifier ? `?guest=${guestIdentifier}&join=true` : '';
		if (session.is_tournament_mode) {
			throw redirect(303, `/session/${id}/tournament-events${guestParam}`);
		} else {
			const { discipline, level } = params;
			throw redirect(303, `/session/${id}/${discipline}/${level}${guestParam}`);
		}
	},

	endSession: async ({ params, locals: { supabase }, url }) => {
		const { id } = params;
		const guestIdentifier = url.searchParams.get('guest');

		// セッション認証
		const authResult = await authenticateAction(supabase, id, guestIdentifier);

		if (!authResult) {
			return fail(401, { error: '認証が必要です。' });
		}

		const { user } = authResult;

		const session = await fetchSessionDetails(supabase, id, { throwOnError: false });
		if (!session) {
			return fail(404, { error: '検定が見つかりません。' });
		}
		const isChief = isChiefJudge(user, session);

		// 主任検定員または複数検定員モードOFFの場合のみ実行可能
		if (!isChief && session.is_multi_judge) {
			return fail(403, { error: 'セッションを終了する権限がありません。' });
		}

		// セッションを終了状態に更新
		const { error: updateError } = await supabase
			.from('sessions')
			.update({
				status: 'ended',
				is_active: false,
				active_prompt_id: null
			})
			.eq('id', id);

		if (updateError) {
			console.error('Error ending session:', updateError);
			return fail(500, { error: '検定の終了に失敗しました。' });
		}

		console.log('[主任検定員] ✅ セッションを終了しました', { sessionId: id });

		const guestParam = guestIdentifier ? `&guest=${guestIdentifier}` : '';
		throw redirect(303, `/session/${id}?ended=true${guestParam}`);
	}
};
