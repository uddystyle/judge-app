import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals: { supabase }, url }) => {
	const {
		data: { user },
		error: userError
	} = await supabase.auth.getUser();

	const { id: sessionId } = params;
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

	// セッション情報を取得して、主任検定員かどうかを確認
	const { data: sessionDetails, error: sessionError } = await supabase
		.from('sessions')
		.select('id, name, chief_judge_id, is_tournament_mode, is_multi_judge, session_date')
		.eq('id', sessionId)
		.single();

	if (sessionError) {
		throw error(404, '検定が見つかりません。');
	}

	// 得点入力ページへのアクセスの場合は権限チェックをスキップ
	// （一般検定員も得点入力ページにはアクセスできる必要がある）
	if (url.pathname.includes('/score')) {
		return { isTournamentMode: sessionDetails.is_tournament_mode };
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
		isTournamentMode: sessionDetails.is_tournament_mode,
		isMultiJudge: sessionDetails.is_multi_judge,
		isChief,
		sessionDetails,
		user,
		guestIdentifier,
		guestParticipant,
		profile
	};
};

export const actions: Actions = {
	// この'setPrompt'アクションは、ゼッケン番号確定フォームから呼び出される
	setPrompt: async ({ request, params, locals: { supabase } }) => {
		const {
			data: { user },
			error: userError
		} = await supabase.auth.getUser();

		if (userError || !user) {
			throw redirect(303, '/login');
		}

		// セッション情報を取得して権限をチェック
		const { data: sessionData, error: sessionError } = await supabase
			.from('sessions')
			.select('chief_judge_id, is_multi_judge')
			.eq('id', params.id)
			.single();

		if (sessionError) {
			return fail(500, { error: 'セッション情報の取得に失敗しました。' });
		}

		const isChief = user.id === sessionData.chief_judge_id;
		const isMultiJudge = sessionData.is_multi_judge;

		// 複数検定員モードONの場合、主任検定員のみがゼッケン番号を確定できる
		if (!isChief && isMultiJudge) {
			return fail(403, { error: 'ゼッケン番号を確定する権限がありません。' });
		}

		const formData = await request.formData();
		const bib = Number(formData.get('bib'));

		if (!bib || bib < 1 || bib > 999) {
			return fail(400, { error: 'ゼッケン番号が正しくありません。' });
		}

		// 1. scoring_promptsテーブルに新しい採点指示を作成
		const { data: newPrompt, error: promptError } = await supabase
			.from('scoring_prompts')
			.insert({
				session_id: params.id,
				discipline: params.discipline,
				level: params.level,
				event_name: params.event,
				bib_number: bib
			})
			.select('id')
			.single();

		if (promptError) {
			console.error('Failed to create scoring prompt:', promptError);
			console.error('Prompt error details:', JSON.stringify(promptError, null, 2));
			return fail(500, { error: `採点指示の作成に失敗しました: ${promptError.message || JSON.stringify(promptError)}` });
		}

		// 2. sessionsテーブルのactive_prompt_idを、今作成した指示のIDに更新
		//    is_activeもtrueにして、検定を再開する（検定終了後の再開にも対応）
		//    この更新が、他の検定員へのRealtime通知のトリガーになる
		const { error: sessionUpdateError } = await supabase
			.from('sessions')
			.update({ active_prompt_id: newPrompt.id, is_active: true })
			.eq('id', params.id);

		if (sessionUpdateError) {
			console.error('Failed to update session:', sessionUpdateError);
			return fail(500, { error: 'セッションの更新に失敗しました。' });
		}

		// 成功したら、主任検定員自身も得点入力ページへ移動
		throw redirect(
			303,
			`/session/${params.id}/${params.discipline}/${params.level}/${params.event}/score`
		);
	}
};
