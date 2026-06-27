import type { SupabaseClient } from '@supabase/supabase-js';
import { createSessionMonitorChannel, type RealtimeChannelHandle } from '$lib/realtime';

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

	return createSessionMonitorChannel(supabase, {
		sessionId,
		channelPrefix: 'session-finalize',
		onPayload: async (payload: any) => {
			const oldIsActive = payload.old.is_active;
			const newIsActive = payload.new.is_active;
			const oldActivePromptId = payload.old.active_prompt_id;
			const newActivePromptId = payload.new.active_prompt_id;

			// セッションが終了した場合
			if (oldIsActive === true && newIsActive === false) {
				onNavigate(`/session/${sessionId}?ended=true`);
				return;
			}

			// 新しいactive_prompt_idが設定された場合（次の滑走者）
			if (newActivePromptId && newActivePromptId !== oldActivePromptId) {
				const { data: promptData, error: promptError } = await supabase
					.from('scoring_prompts')
					.select('*')
					.eq('id', newActivePromptId)
					.single();

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
					// いずれにせよ無音 no-op で前の滑走者の画面に留まらせない。
					const target = participant
						? `/session/${sessionId}/score/${modeType}/${eventId}/input?bib=${promptData.bib_number}&participantId=${participant.id}`
						: `/session/${sessionId}/score/${modeType}/${eventId}/input?bib=${promptData.bib_number}`;
					onNavigate(target);
					return;
				}

				// #6: プロンプト自体が読めない場合もスコアベースへフォールバックし、停滞を防ぐ
				onNavigate(`/session/${sessionId}/score/${modeType}/${eventId}`);
				return;
			}

			// active_prompt_idがnullになったら、採点が確定された
			if (newActivePromptId === null && oldActivePromptId !== null) {
				onNavigate(`/session/${sessionId}`);
			}
		}
	});
}
