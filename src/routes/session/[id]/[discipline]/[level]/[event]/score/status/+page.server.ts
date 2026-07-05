import { error, fail, redirect } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { authenticateSession, authenticateAction } from '$lib/server/sessionAuth';
import {
	fetchSessionDetails,
	fetchUserProfile,
	isChiefJudge,
	fetchActivePrompt
} from '$lib/server/sessionHelpers';
import { calculateFinalScore } from '$lib/scoreCalculation';
import { logger } from '$lib/server/logger';

export const load: PageServerLoad = async ({ params, locals: { supabase }, url }) => {
	const sessionId = params.id;
	const { discipline, level, event } = params;
	const guestIdentifier = url.searchParams.get('guest');
	const bib = url.searchParams.get('bib');

	// セッション認証
	const { user, guestParticipant } = await authenticateSession(
		supabase,
		sessionId,
		guestIdentifier
	);

	const sessionDetails = await fetchSessionDetails(supabase, sessionId);
	const profile = await fetchUserProfile(supabase, user);

	// 初期スコアデータを取得（SSR）
	let initialScoreStatus: { scores: any[]; requiredJudges: number } = {
		scores: [],
		requiredJudges: 1
	};

	if (bib && discipline && level && event) {
		// owner 列(judge_id/guest_identifier)も載せ、修正要求の削除を owner 基準にできるようにする
		// （ScoresTable が hidden で送る。同名検定員でも本人の行だけ削除する）。
		const { data: scores } = await supabase
			.from('results')
			.select('judge_name, score, judge_id, guest_identifier')
			.eq('session_id', sessionId)
			.eq('bib', parseInt(bib))
			.eq('discipline', discipline)
			.eq('level', level)
			.eq('event_name', event);

		// 検定は required_judges（主任設定）を必要数に使う（大会の 3/5 慣習は適用しない）。
		const requiredJudges = sessionDetails.required_judges || 1;
		initialScoreStatus = {
			scores: scores || [],
			requiredJudges
		};
	}

	return {
		user,
		sessionDetails,
		guestIdentifier,
		guestParticipant,
		profile,
		initialScoreStatus
	};
};

export const actions: Actions = {
	requestCorrection: async ({ request, params, locals: { supabase }, url }) => {
		const guestIdentifier = url.searchParams.get('guest');

		// セッション認証
		const authResult = await authenticateAction(supabase, params.id, guestIdentifier);

		if (!authResult) {
			return fail(401, { error: '認証が必要です。' });
		}

		const { user } = authResult;

		const { id, discipline, level, event } = params;
		const formData = await request.formData();
		const bib = formData.get('bib') as string;
		const judgeName = formData.get('judgeName') as string;
		const judgeId = formData.get('judgeId') as string;
		const formGuestIdentifier = formData.get('guestIdentifier') as string;

		logger.debug('[requestCorrection] 修正要求を受信:', { bib, judgeName, sessionId: id });

		if (!bib || !judgeName) {
			return fail(400, { error: 'パラメータが不足しています。' });
		}

		// セッション情報を取得して権限をチェック
		const sessionData = await fetchSessionDetails(supabase, id, { throwOnError: false });
		if (!sessionData) {
			return fail(500, { error: 'セッション情報の取得に失敗しました。' });
		}
		const isChief = isChiefJudge(user, sessionData);
		const isMultiJudge = sessionData.is_multi_judge;

		// 複数検定員モードONの場合、主任検定員のみが修正を要求できる
		if (!isChief && isMultiJudge) {
			return fail(403, { error: '修正を要求する権限がありません。' });
		}

		// 該当する検定員の得点を削除
		logger.debug('[requestCorrection] 得点を削除中...', {
			session_id: id,
			bib,
			discipline,
			level,
			event_name: event,
			judge_name: judgeName
		});

		// owner(judge_id/guest_identifier)で対象検定員の行だけを削除する。フォームが owner を
		// 渡すので、同名検定員が居ても誤って別の行/両方を消さない。owner 未提供時のみ judge_name 後方互換。
		let deleteQuery = supabase
			.from('results')
			.delete({ count: 'exact' })
			.eq('session_id', id)
			.eq('bib', bib)
			.eq('discipline', discipline)
			.eq('level', level)
			.eq('event_name', event);
		if (formGuestIdentifier) {
			deleteQuery = deleteQuery.eq('guest_identifier', formGuestIdentifier);
		} else if (judgeId) {
			deleteQuery = deleteQuery.eq('judge_id', judgeId);
		} else {
			deleteQuery = deleteQuery.eq('judge_name', judgeName);
		}
		const { data: deletedData, error: deleteError, count } = await deleteQuery.select();

		if (deleteError) {
			logger.error('[requestCorrection] ❌ 削除失敗:', deleteError);
			return fail(500, { error: '得点の削除に失敗しました。' });
		}

		logger.debug('[requestCorrection] 削除結果:', {
			judgeName,
			deletedCount: count,
			deletedRows: deletedData?.length || 0,
			deletedData
		});

		if (!count || count === 0) {
			logger.error(
				'[requestCorrection] ⚠️ 削除された行が0件です。RLSポリシーの問題の可能性があります。'
			);
			return fail(500, { error: '得点の削除に失敗しました（削除された行が0件）。' });
		}

		logger.debug('[requestCorrection] ✅ 削除成功:', { judgeName, deletedCount: count });
		return { success: true, message: `${judgeName}に修正を要求しました。` };
	},

	finalizeScore: async ({ request, params, locals: { supabase }, url }) => {
		const guestIdentifier = url.searchParams.get('guest');

		// セッション認証
		const authResult = await authenticateAction(supabase, params.id, guestIdentifier);

		if (!authResult) {
			return fail(401, { error: '認証が必要です。' });
		}

		const { user } = authResult;

		const { id, discipline, level, event } = params;
		const formData = await request.formData();
		const bib = formData.get('bib') as string;

		if (!bib) {
			return fail(400, { error: 'ゼッケン番号が指定されていません。' });
		}

		// セッション情報を取得して権限をチェック
		const sessionData = await fetchSessionDetails(supabase, id, { throwOnError: false });
		if (!sessionData) {
			return fail(500, { error: 'セッション情報の取得に失敗しました。' });
		}
		const isChief = isChiefJudge(user, sessionData);
		const isMultiJudge = sessionData.is_multi_judge;

		// 複数検定員モードONの場合、主任検定員のみが確定できる
		if (!isChief && isMultiJudge) {
			return fail(403, { error: '得点を確定する権限がありません。' });
		}

		// 全ての得点を取得
		const { data: scores, error: scoresError } = await supabase
			.from('results')
			.select('score')
			.eq('session_id', id)
			.eq('bib', bib)
			.eq('discipline', discipline)
			.eq('level', level)
			.eq('event_name', event);

		if (scoresError) {
			return fail(500, { error: '得点の取得に失敗しました。' });
		}

		if (!scores || scores.length === 0) {
			return fail(400, { error: '採点結果がありません。' });
		}

		// M1/M2: 検定は required_judges（主任設定）をサーバ側で強制。single-judge は 1＝実質ゲート無し。
		const requiredCount = isMultiJudge ? sessionData.required_judges || 1 : 1;
		if (scores.length < requiredCount) {
			return fail(400, { error: `必要な採点数（${requiredCount}人）に達していません。` });
		}

		const useSum = !!(sessionData.is_tournament_mode && sessionData.score_calculation === 'sum');
		const scoreValues = scores.map((s) => s.score);

		const calcResult = calculateFinalScore(scoreValues, {
			useSum,
			excludeExtremes: useSum && (sessionData.exclude_extremes || false)
		});

		if (!calcResult.success) {
			return fail(400, { error: calcResult.error });
		}

		const finalScore = calcResult.finalScore;

		// active_prompt_id のクリアを compare-and-swap 化（新フロー #3 と同方針）。
		// 二度押しや、次の滑走者の prompt が既にセットされている場合に、それを誤って消さない。
		// 今確定する bib の prompt が依然 active な場合のみクリアする。
		const activePrompt = await fetchActivePrompt(supabase, id);
		if (activePrompt && activePrompt.bib_number === parseInt(bib)) {
			await supabase
				.from('sessions')
				.update({ active_prompt_id: null })
				.eq('id', id)
				.eq('active_prompt_id', activePrompt.id);
		}

		// 完了画面へリダイレクト
		const guestParam = guestIdentifier ? `&guest=${guestIdentifier}` : '';
		throw redirect(
			303,
			`/session/${id}/${discipline}/${level}/${event}/score/complete?bib=${bib}&score=${finalScore}${guestParam}`
		);
	}
};
