import { error, fail, redirect } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';

export const load: PageServerLoad = async ({ params, locals: { supabase }, url }) => {
	const {
		data: { user },
		error: userError
	} = await supabase.auth.getUser();

	const { id: sessionId, eventId } = params;
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

	// 大会モードでない場合はエラー
	if (!sessionDetails.is_tournament_mode) {
		throw redirect(303, `/session/${sessionId}`);
	}

	// カスタム種目の情報を取得
	const { data: customEvent, error: eventError } = await supabase
		.from('custom_events')
		.select('*')
		.eq('id', eventId)
		.eq('session_id', sessionId)
		.single();

	if (eventError) {
		console.error('Error fetching custom event:', eventError);
		throw error(404, '種目が見つかりません。');
	}

	const isChief = user ? user.id === sessionDetails.chief_judge_id : false;
	// 大会モードは常に複数検定員モードON
	const isMultiJudge = true;

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
		customEvent,
		isChief,
		isMultiJudge,
		guestParticipant,
		guestIdentifier,
		profile
	};
};

export const actions: Actions = {
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

		const { id: sessionId, eventId } = params;
		const formData = await request.formData();
		const bib = formData.get('bib') as string;

		if (!bib) {
			return fail(400, { error: 'ゼッケン番号が指定されていません。' });
		}

		// セッション情報を取得して権限をチェック
		const { data: sessionData, error: sessionError } = await supabase
			.from('sessions')
			.select('*')
			.eq('id', sessionId)
			.single();

		if (sessionError) {
			return fail(500, { error: 'セッション情報の取得に失敗しました。' });
		}

		const isChief = user ? user.id === sessionData.chief_judge_id : false;
		// 大会モードは常に複数検定員モードON
		const isMultiJudge = true;

		// 複数検定員モードONの場合、主任検定員のみが確定できる
		if (!isChief && isMultiJudge) {
			return fail(403, { error: '得点を確定する権限がありません。' });
		}

		// カスタム種目の情報を取得
		const { data: customEvent, error: eventError } = await supabase
			.from('custom_events')
			.select('*')
			.eq('id', eventId)
			.eq('session_id', sessionId)
			.single();

		if (eventError) {
			return fail(404, { error: '種目が見つかりません。' });
		}

		// 全ての得点を取得
		const { data: scores, error: scoresError } = await supabase
			.from('results')
			.select('score')
			.eq('session_id', sessionId)
			.eq('bib', bib)
			.eq('discipline', customEvent.discipline)
			.eq('level', customEvent.level)
			.eq('event_name', customEvent.event_name);

		if (scoresError) {
			return fail(500, { error: '得点の取得に失敗しました。' });
		}

		if (!scores || scores.length === 0) {
			return fail(400, { error: '採点結果がありません。' });
		}

		let finalScore = 0;

		// 3審3採 or 5審3採によって計算方法を変える
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

		// active_prompt_idをクリアして次の採点を受け付けられるようにする
		await supabase.from('sessions').update({ active_prompt_id: null }).eq('id', sessionId);

		// 完了画面へリダイレクト
		throw redirect(
			303,
			`/session/${sessionId}/tournament-events/${eventId}/score/complete?bib=${bib}&score=${finalScore}`
		);
	}
};
