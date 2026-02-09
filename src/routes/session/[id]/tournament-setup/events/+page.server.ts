import { error, fail, redirect } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { authenticateSession } from '$lib/server/sessionAuth';

export const load: PageServerLoad = async ({ params, locals: { supabase } }) => {
	const { id: sessionId } = params;

	// セッション認証（ログインユーザー専用）
	const { user } = await authenticateSession(supabase, sessionId, null);

	// セッション情報を取得
	const { data: sessionDetails, error: sessionError } = await supabase
		.from('sessions')
		.select('*')
		.eq('id', sessionId)
		.single();

	if (sessionError) {
		throw error(404, '検定が見つかりません。');
	}

	// 大会モードでない場合はダッシュボードにリダイレクト
	if (!sessionDetails.is_tournament_mode) {
		throw redirect(303, '/dashboard');
	}

	// 作成者または主任検定員のみアクセス可能
	const isAuthorized =
		sessionDetails.created_by === user.id ||
		sessionDetails.chief_judge_id === user.id;

	if (!isAuthorized) {
		throw redirect(303, `/session/${sessionId}`);
	}

	// カスタム種目の一覧を取得
	const { data: events, error: eventsError } = await supabase
		.from('custom_events')
		.select('*')
		.eq('session_id', sessionId)
		.order('display_order', { ascending: true });

	if (eventsError) {
		console.error('Error fetching events:', eventsError);
		throw error(500, '種目の取得に失敗しました。');
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
		events: events || []
	};
};

export const actions: Actions = {
	// 種目を追加
	addEvent: async ({ request, params, locals: { supabase } }) => {
		const {
			data: { user },
			error: userError
		} = await supabase.auth.getUser();

		if (userError || !user) {
			return fail(401, { error: '認証が必要です。' });
		}

		const formData = await request.formData();
		const eventName = formData.get('eventName') as string;

		// バリデーション
		if (!eventName) {
			return fail(400, { error: '種目名を入力してください。' });
		}

		// 現在の最大display_orderを取得
		const { data: maxOrderData } = await supabase
			.from('custom_events')
			.select('display_order')
			.eq('session_id', params.id)
			.order('display_order', { ascending: false })
			.limit(1)
			.single();

		const nextOrder = (maxOrderData?.display_order || 0) + 1;

		// 種目を追加（discipline, levelは固定値）
		const { error: insertError } = await supabase.from('custom_events').insert({
			session_id: params.id,
			discipline: '大会',
			level: '共通',
			event_name: eventName.trim(),
			display_order: nextOrder
		});

		if (insertError) {
			console.error('Error adding event:', insertError);
			return fail(500, { error: '種目の追加に失敗しました。' });
		}

		return { success: true, message: '種目を追加しました。' };
	},

	// 種目を削除
	deleteEvent: async ({ request, params, locals: { supabase } }) => {
		const {
			data: { user },
			error: userError
		} = await supabase.auth.getUser();

		if (userError || !user) {
			return fail(401, { error: '認証が必要です。' });
		}

		const formData = await request.formData();
		const eventId = formData.get('eventId') as string;

		if (!eventId) {
			return fail(400, { error: '種目IDが指定されていません。' });
		}

		// 種目を削除
		const { error: deleteError } = await supabase
			.from('custom_events')
			.delete()
			.eq('id', eventId)
			.eq('session_id', params.id);

		if (deleteError) {
			console.error('Error deleting event:', deleteError);
			return fail(500, { error: '種目の削除に失敗しました。' });
		}

		return { success: true, message: '種目を削除しました。' };
	},

	// 種目を編集
	updateEvent: async ({ request, params, locals: { supabase } }) => {
		const {
			data: { user },
			error: userError
		} = await supabase.auth.getUser();

		if (userError || !user) {
			return fail(401, { error: '認証が必要です。' });
		}

		const formData = await request.formData();
		const eventId = formData.get('eventId') as string;
		const eventName = formData.get('eventName') as string;

		// バリデーション
		if (!eventId || !eventName) {
			return fail(400, { error: '種目名を入力してください。' });
		}

		// 種目を更新
		const { error: updateError } = await supabase
			.from('custom_events')
			.update({
				event_name: eventName.trim()
			})
			.eq('id', eventId)
			.eq('session_id', params.id);

		if (updateError) {
			console.error('Error updating event:', updateError);
			return fail(500, { error: '種目の更新に失敗しました。' });
		}

		return { success: true, message: '種目を更新しました。' };
	}
};
