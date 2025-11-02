import { error, fail, redirect } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';

export const load: PageServerLoad = async ({ params, locals: { supabase } }) => {
	const {
		data: { user },
		error: userError
	} = await supabase.auth.getUser();

	if (userError || !user) {
		throw redirect(303, '/login');
	}

	const { id: sessionId } = params;

	// セッション情報を取得
	const { data: sessionDetails, error: sessionError } = await supabase
		.from('sessions')
		.select('*')
		.eq('id', sessionId)
		.single();

	if (sessionError) {
		throw error(404, 'セッションが見つかりません。');
	}

	// 研修モードでない場合はダッシュボードにリダイレクト
	if (sessionDetails.mode !== 'training') {
		throw redirect(303, '/dashboard');
	}

	// 作成者または主任検定員のみアクセス可能
	const isAuthorized =
		sessionDetails.created_by === user.id ||
		sessionDetails.chief_judge_id === user.id;

	if (!isAuthorized) {
		throw redirect(303, `/session/${sessionId}`);
	}

	// 研修種目の一覧を取得
	const { data: events, error: eventsError } = await supabase
		.from('training_events')
		.select('*')
		.eq('session_id', sessionId)
		.order('order_index', { ascending: true });

	if (eventsError) {
		console.error('Error fetching events:', eventsError);
		throw error(500, '種目の取得に失敗しました。');
	}

	return {
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

		// 現在の最大order_indexを取得
		const { data: maxOrderData } = await supabase
			.from('training_events')
			.select('order_index')
			.eq('session_id', params.id)
			.order('order_index', { ascending: false })
			.limit(1)
			.single();

		const nextOrder = (maxOrderData?.order_index || 0) + 1;

		// 種目を追加
		const { error: insertError } = await supabase.from('training_events').insert({
			session_id: params.id,
			name: eventName.trim(),
			order_index: nextOrder,
			min_score: 0,
			max_score: 100,
			score_precision: 1,
			status: 'pending'
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
			.from('training_events')
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
			.from('training_events')
			.update({
				name: eventName.trim()
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
