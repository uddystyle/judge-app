import { fail } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import * as m from '$lib/paraglide/messages.js';

// 種目管理アクション（details ページ、大会・研修共通）。挙動は page.server.actions.test.ts で固定。

// 種目を追加（大会・研修共通）
export const addEvent = async ({ request, params, locals: { supabase } }: RequestEvent) => {
	const {
		data: { user },
		error: userError
	} = await supabase.auth.getUser();

	if (userError || !user) {
		return fail(401, { eventError: m.action_authRequired() });
	}

	const formData = await request.formData();
	const eventName = formData.get('eventName') as string;

	if (!eventName || !eventName.trim()) {
		return fail(400, { eventError: m.action_eventNameRequired() });
	}

	// セッション情報を取得してモードを確認
	const { data: session } = await supabase
		.from('sessions')
		.select('mode, is_tournament_mode')
		.eq('id', params.id)
		.single();

	if (!session) {
		return fail(404, { eventError: m.action_sessionNotFound() });
	}

	const isTournament = session.is_tournament_mode || session.mode === 'tournament';
	const isTraining = session.mode === 'training';

	if (isTournament) {
		// 大会モード: custom_events
		const { data: maxOrderData } = await supabase
			.from('custom_events')
			.select('display_order')
			.eq('session_id', params.id)
			.order('display_order', { ascending: false })
			.limit(1)
			.single();

		const nextOrder = (maxOrderData?.display_order || 0) + 1;

		const { error: insertError } = await supabase.from('custom_events').insert({
			session_id: params.id,
			discipline: '大会',
			level: '共通',
			event_name: eventName.trim(),
			display_order: nextOrder
		});

		if (insertError) {
			return fail(500, { eventError: m.action_eventAddFailed() });
		}
	} else if (isTraining) {
		// 研修モード: training_events
		const { data: maxOrderData } = await supabase
			.from('training_events')
			.select('order_index')
			.eq('session_id', params.id)
			.order('order_index', { ascending: false })
			.limit(1)
			.single();

		const nextOrder = (maxOrderData?.order_index || 0) + 1;

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
			return fail(500, { eventError: m.action_eventAddFailed() });
		}
	}

	return { eventSuccess: m.action_eventAdded() };
};

// 種目を更新（大会・研修共通）
export const updateEvent = async ({ request, params, locals: { supabase } }: RequestEvent) => {
	const {
		data: { user },
		error: userError
	} = await supabase.auth.getUser();

	if (userError || !user) {
		return fail(401, { eventError: m.action_authRequired() });
	}

	const formData = await request.formData();
	const eventId = formData.get('eventId') as string;
	const eventName = formData.get('eventName') as string;
	const isTraining = formData.get('isTraining') === 'true';

	if (!eventName || !eventName.trim()) {
		return fail(400, { eventError: m.action_eventNameRequired() });
	}

	if (isTraining) {
		// 研修モード: training_events
		const { error: updateError } = await supabase
			.from('training_events')
			.update({ name: eventName.trim() })
			.eq('id', eventId)
			.eq('session_id', params.id);

		if (updateError) {
			return fail(500, { eventError: m.action_eventUpdateFailed() });
		}
	} else {
		// 大会モード: custom_events
		const { error: updateError } = await supabase
			.from('custom_events')
			.update({ event_name: eventName.trim() })
			.eq('id', eventId)
			.eq('session_id', params.id);

		if (updateError) {
			return fail(500, { eventError: m.action_eventUpdateFailed() });
		}
	}

	return { eventSuccess: m.action_eventUpdated() };
};

// 種目を削除（大会・研修共通）
export const deleteEvent = async ({ request, params, locals: { supabase } }: RequestEvent) => {
	const {
		data: { user },
		error: userError
	} = await supabase.auth.getUser();

	if (userError || !user) {
		return fail(401, { eventError: m.action_authRequired() });
	}

	const formData = await request.formData();
	const eventId = formData.get('eventId') as string;
	const isTraining = formData.get('isTraining') === 'true';

	if (!eventId) {
		return fail(400, { eventError: m.action_eventIdMissing() });
	}

	if (isTraining) {
		// 研修モード: training_events
		const { error: deleteError } = await supabase
			.from('training_events')
			.delete()
			.eq('id', eventId)
			.eq('session_id', params.id);

		if (deleteError) {
			return fail(500, { eventError: m.action_eventDeleteFailed() });
		}
	} else {
		// 大会モード: custom_events
		const { error: deleteError } = await supabase
			.from('custom_events')
			.delete()
			.eq('id', eventId)
			.eq('session_id', params.id);

		if (deleteError) {
			return fail(500, { eventError: m.action_eventDeleteFailed() });
		}
	}

	return { eventSuccess: m.action_eventDeleted() };
};
