import type { SupabaseClient } from '@supabase/supabase-js';
import { createSessionMonitorWithPolling, type RealtimeChannelHandle } from '$lib/realtime';

export interface SessionNavigationConfig {
	supabase: SupabaseClient;
	sessionId: string;
	modeType: string;
	eventId: string;
	onNavigate: (url: string) => void;
	onBibChange: (bib: number) => void;
}

export function createSessionNavigationMonitor(
	config: SessionNavigationConfig
): RealtimeChannelHandle {
	const { supabase, sessionId, modeType, eventId, onNavigate, onBibChange } = config;

	// realtime と polling の両方から参照する「直近の active_prompt_id」。
	// polling は old/new payload を持たないため、変化検知にこの値を使う。
	// undefined = 未シード（polling 初回は記録のみで遷移しない）。
	let lastActivePromptId: string | null | undefined = undefined;

	// 次の滑走者プロンプトへ遷移する共通処理（realtime/polling 双方から呼ぶ）。
	async function navigateToPrompt(activePromptId: string) {
		const { data: promptData, error: promptError } = await supabase
			.from('scoring_prompts')
			.select('*')
			.eq('id', activePromptId)
			.maybeSingle();

		if (!promptError && promptData) {
			onBibChange(promptData.bib_number);
			const { data: participant } = await supabase
				.from('participants')
				.select('id')
				.eq('session_id', sessionId)
				.eq('bib_number', promptData.bib_number)
				.maybeSingle();

			// #6: participant が解決できればそのまま、できなければ bib のみで input へ遷移する
			// （input 側が bib から participantId を解決/リダイレクトする）。
			const target = participant
				? `/session/${sessionId}/score/${modeType}/${eventId}/input?bib=${promptData.bib_number}&participantId=${participant.id}`
				: `/session/${sessionId}/score/${modeType}/${eventId}/input?bib=${promptData.bib_number}`;
			onNavigate(target);
			return;
		}

		// #6: プロンプト自体が読めない場合もスコアベースへフォールバックし、停滞を防ぐ
		onNavigate(`/session/${sessionId}/score/${modeType}/${eventId}`);
	}

	return createSessionMonitorWithPolling(supabase, {
		sessionId,
		channelPrefix: 'session-finalize',
		onRealtimePayload: async (payload: any) => {
			const oldIsActive = payload.old.is_active;
			const newIsActive = payload.new.is_active;
			const oldActivePromptId = payload.old.active_prompt_id;
			const newActivePromptId = payload.new.active_prompt_id;

			// realtime が拾った変化を polling 側の基準にも反映（二重発火を防ぐ）。
			lastActivePromptId = newActivePromptId;

			// セッションが終了した場合
			if (oldIsActive === true && newIsActive === false) {
				onNavigate(`/session/${sessionId}?ended=true`);
				return;
			}

			// 新しいactive_prompt_idが設定された場合（次の滑走者）
			if (newActivePromptId && newActivePromptId !== oldActivePromptId) {
				await navigateToPrompt(newActivePromptId);
				return;
			}

			// active_prompt_idがnullになったら、採点が確定された
			if (newActivePromptId === null && oldActivePromptId !== null) {
				onNavigate(`/session/${sessionId}`);
			}
		},
		// realtime 瞬断時の保険。realtime が落ちている間に起きた active_prompt 変化を拾う。
		onPollingData: async ({ is_active, active_prompt_id }) => {
			// 初回ポーリングは現在値をシードするだけ（誤遷移を防ぐ）。
			if (lastActivePromptId === undefined) {
				lastActivePromptId = active_prompt_id;
				return;
			}

			if (is_active === false) {
				onNavigate(`/session/${sessionId}?ended=true`);
				return;
			}

			if (active_prompt_id && active_prompt_id !== lastActivePromptId) {
				lastActivePromptId = active_prompt_id;
				await navigateToPrompt(active_prompt_id);
				return;
			}

			if (active_prompt_id === null && lastActivePromptId !== null) {
				lastActivePromptId = null;
				onNavigate(`/session/${sessionId}`);
			}
		}
	});
}
