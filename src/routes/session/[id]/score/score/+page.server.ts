import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';

export const load: PageServerLoad = async ({ params, locals: { supabase } }) => {
	const {
		data: { user },
		error: userError
	} = await supabase.auth.getUser();

	if (userError || !user) {
		throw redirect(303, '/login');
	}

	const { id: sessionId, eventId } = params;

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

	// 主任検定員のみアクセス可能
	if (user.id !== sessionDetails.chief_judge_id) {
		throw redirect(303, `/session/${sessionId}`);
	}

	// プロフィールと組織情報を取得
	const { data: profileData } = await supabase
		.from('profiles')
		.select('*')
		.eq('id', user.id)
		.single();

	const profile = profileData;

	const { data: orgData } = await supabase
		.from('organization_members')
		.select('organization_id, organizations(id, name)')
		.eq('user_id', user.id);

	const organizations = orgData || [];

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

	return {
		sessionDetails,
		customEvent,
		user,
		profile,
		organizations
	};
};

export const actions: Actions = {
	// ゼッケン番号を送信して採点指示を作成
	submitBib: async ({ request, params, locals: { supabase } }) => {
		const {
			data: { user },
			error: userError
		} = await supabase.auth.getUser();

		if (userError || !user) {
			return { success: false, error: '認証が必要です。' };
		}

		const formData = await request.formData();
		const bibNumber = parseInt(formData.get('bibNumber') as string);

		if (isNaN(bibNumber) || bibNumber <= 0) {
			return { success: false, error: 'ゼッケン番号は正の整数である必要があります。' };
		}

		const { id: sessionId, eventId } = params;

		// カスタム種目の情報を取得
		const { data: customEvent, error: eventError } = await supabase
			.from('custom_events')
			.select('*')
			.eq('id', eventId)
			.eq('session_id', sessionId)
			.single();

		if (eventError) {
			return { success: false, error: '種目が見つかりません。' };
		}

		// 採点指示を作成
		const { data: prompt, error: promptError } = await supabase
			.from('scoring_prompts')
			.insert({
				session_id: sessionId,
				discipline: customEvent.discipline,
				level: customEvent.level,
				event_name: customEvent.event_name,
				bib_number: bibNumber
			})
			.select()
			.single();

		if (promptError) {
			console.error('Error creating scoring prompt:', promptError);
			return { success: false, error: '採点指示の作成に失敗しました。' };
		}

		// セッションのactive_prompt_idを更新
		const { error: updateError } = await supabase
			.from('sessions')
			.update({ active_prompt_id: prompt.id })
			.eq('id', sessionId);

		if (updateError) {
			console.error('Error updating session:', updateError);
			return { success: false, error: 'セッションの更新に失敗しました。' };
		}

		return { success: true, bibNumber };
	}
};
