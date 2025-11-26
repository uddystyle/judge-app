import { error, fail, redirect } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';

export const load: PageServerLoad = async ({ params, locals: { supabase }, url }) => {
	const {
		data: { user },
		error: userError
	} = await supabase.auth.getUser();

	const sessionId = params.id;
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

	// セッションの詳細情報を取得
	const { data: sessionDetails, error: sessionError } = await supabase
		.from('sessions')
		.select('*')
		.eq('id', sessionId)
		.single();

	if (sessionError) {
		throw error(404, '検定が見つかりません。');
	}

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
		user,
		sessionDetails,
		guestIdentifier,
		guestParticipant,
		profile
	};
};

export const actions: Actions = {
	requestCorrection: async ({ request, params, locals: { supabase }, url }) => {
		const {
			data: { user },
			error: userError
		} = await supabase.auth.getUser();

		const guestIdentifier = url.searchParams.get('guest');

		// ゲストユーザーの認証
		if (!user && guestIdentifier) {
			const { data: guestData, error: guestError } = await supabase
				.from('session_participants')
				.select('*')
				.eq('guest_identifier', guestIdentifier)
				.eq('is_guest', true)
				.single();

			if (guestError || !guestData) {
				return fail(401, { error: 'ゲスト認証が必要です。' });
			}
		} else if (userError || !user) {
			throw redirect(303, '/login');
		}

		const { id, discipline, level, event } = params;
		const formData = await request.formData();
		const bib = formData.get('bib') as string;
		const judgeName = formData.get('judgeName') as string;

		console.log('[requestCorrection] 修正要求を受信:', { bib, judgeName, sessionId: id });

		if (!bib || !judgeName) {
			return fail(400, { error: 'パラメータが不足しています。' });
		}

		// セッション情報を取得して権限をチェック
		const { data: sessionData, error: sessionError } = await supabase
			.from('sessions')
			.select('chief_judge_id, is_multi_judge')
			.eq('id', id)
			.single();

		if (sessionError) {
			return fail(500, { error: 'セッション情報の取得に失敗しました。' });
		}

		const isChief = user ? user.id === sessionData.chief_judge_id : false;
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
		const {
			data: { user },
			error: userError
		} = await supabase.auth.getUser();

		const guestIdentifier = url.searchParams.get('guest');

		// ゲストユーザーの認証
		if (!user && guestIdentifier) {
			const { data: guestData, error: guestError } = await supabase
				.from('session_participants')
				.select('*')
				.eq('guest_identifier', guestIdentifier)
				.eq('is_guest', true)
				.single();

			if (guestError || !guestData) {
				return fail(401, { error: 'ゲスト認証が必要です。' });
			}
		} else if (userError || !user) {
			throw redirect(303, '/login');
		}

		const { id, discipline, level, event } = params;
		const formData = await request.formData();
		const bib = formData.get('bib') as string;

		if (!bib) {
			return fail(400, { error: 'ゼッケン番号が指定されていません。' });
		}

		// セッション情報を取得して権限をチェック
		const { data: sessionData, error: sessionError } = await supabase
			.from('sessions')
			.select('chief_judge_id, is_tournament_mode, exclude_extremes, score_calculation, is_multi_judge')
			.eq('id', id)
			.single();

		if (sessionError) {
			return fail(500, { error: 'セッション情報の取得に失敗しました。' });
		}

		const isChief = user ? user.id === sessionData.chief_judge_id : false;
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

		let finalScore = 0;

		// 大会モードで合計点方式の場合
		if (sessionData.is_tournament_mode && sessionData.score_calculation === 'sum') {
			if (sessionData.exclude_extremes) {
				// 5審3採: 最大・最小を除く3人の合計
				if (scores.length < 5) {
					return fail(400, {
						error: `5審3採では5人の採点が必要です。現在${scores.length}人です。`
					});
				}

				const scoreValues = scores.map((s) => s.score).sort((a, b) => a - b);
				// 最小と最大を除いた中間3つの合計
				const middleThree = scoreValues.slice(1, 4);
				finalScore = middleThree.reduce((sum, s) => sum + s, 0);
			} else {
				// 3審3採: 3人の合計
				if (scores.length < 3) {
					return fail(400, {
						error: `3審3採では3人の採点が必要です。現在${scores.length}人です。`
					});
				}

				const scoreValues = scores.map((s) => s.score);
				finalScore = scoreValues.reduce((sum, s) => sum + s, 0);
			}
		} else {
			// 検定モード: 平均点を計算
			const total = scores.reduce((sum, s) => sum + s.score, 0);
			finalScore = Math.round(total / scores.length);
		}

		// active_prompt_idをクリアして次の採点を受け付けられるようにする
		await supabase.from('sessions').update({ active_prompt_id: null }).eq('id', id);

		// 完了画面へリダイレクト
		throw redirect(
			303,
			`/session/${id}/${discipline}/${level}/${event}/score/complete?bib=${bib}&score=${finalScore}`
		);
	}
};
