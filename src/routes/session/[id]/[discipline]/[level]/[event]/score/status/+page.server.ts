import { error, fail, redirect } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { authenticateSession, authenticateAction } from '$lib/server/sessionAuth';
import {
	fetchSessionDetails,
	fetchUserProfile,
	isChiefJudge
} from '$lib/server/sessionHelpers';
import { calculateFinalScore } from '$lib/scoreCalculation';

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
	let initialScoreStatus: { scores: any[]; requiredJudges: number } = { scores: [], requiredJudges: 1 };

	if (bib && discipline && level && event) {
		const { data: scores } = await supabase
			.from('results')
			.select('judge_name, score')
			.eq('session_id', sessionId)
			.eq('bib', parseInt(bib))
			.eq('discipline', discipline)
			.eq('level', level)
			.eq('event_name', event);

		const requiredJudges = sessionDetails.exclude_extremes ? 5 : 3;
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

		console.log('[requestCorrection] 修正要求を受信:', { bib, judgeName, sessionId: id });

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
		console.log('[requestCorrection] 得点を削除中...', {
			session_id: id,
			bib,
			discipline,
			level,
			event_name: event,
			judge_name: judgeName
		});

		const { data: deletedData, error: deleteError, count } = await supabase
			.from('results')
			.delete({ count: 'exact' })
			.eq('session_id', id)
			.eq('bib', bib)
			.eq('discipline', discipline)
			.eq('level', level)
			.eq('event_name', event)
			.eq('judge_name', judgeName)
			.select();

		if (deleteError) {
			console.error('[requestCorrection] ❌ 削除失敗:', deleteError);
			return fail(500, { error: '得点の削除に失敗しました。' });
		}

		console.log('[requestCorrection] 削除結果:', {
			judgeName,
			deletedCount: count,
			deletedRows: deletedData?.length || 0,
			deletedData
		});

		if (!count || count === 0) {
			console.error('[requestCorrection] ⚠️ 削除された行が0件です。RLSポリシーの問題の可能性があります。');
			return fail(500, { error: '得点の削除に失敗しました（削除された行が0件）。' });
		}

		console.log('[requestCorrection] ✅ 削除成功:', { judgeName, deletedCount: count });
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

		// active_prompt_idをクリアして次の採点を受け付けられるようにする
		await supabase.from('sessions').update({ active_prompt_id: null }).eq('id', id);

		// 完了画面へリダイレクト
		const guestParam = guestIdentifier ? `&guest=${guestIdentifier}` : '';
		throw redirect(
			303,
			`/session/${id}/${discipline}/${level}/${event}/score/complete?bib=${bib}&score=${finalScore}${guestParam}`
		);
	}
};
