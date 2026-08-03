import type { SupabaseClient } from '@supabase/supabase-js';
import { createSessionMonitorWithPolling, type RealtimeChannelHandle } from '$lib/realtime';

export interface SessionNavigationConfig {
	supabase: SupabaseClient;
	sessionId: string;
	modeType: string;
	eventId: string;
	/** 画面描画時点の値。指定すると初回イベントを変化と誤認しない。 */
	initialActivePromptId?: string | null;
	waitingUrl?: string;
	endedUrl?: string;
	buildPromptUrl?: (
		prompt: { bib_number: number; discipline: string; level: string; event_name: string },
		participantId: string | number | null
	) => string;
	promptFallbackUrl?: string;
	onNavigate: (url: string) => void;
	onBibChange: (bib: number) => void;
}

export function createSessionNavigationMonitor(
	config: SessionNavigationConfig
): RealtimeChannelHandle {
	const { supabase, sessionId, modeType, eventId, onNavigate, onBibChange } = config;
	const waitingUrl = config.waitingUrl ?? `/session/${sessionId}`;
	const endedUrl = config.endedUrl ?? `/session/${sessionId}?ended=true`;

	// realtime と polling の両方から参照する「直近の active_prompt_id」。
	// polling は old/new payload を持たないため、変化検知にこの値を使う。
	// undefined = 未シード（polling 初回は記録のみで遷移しない）。
	let lastActivePromptId: string | null | undefined = config.initialActivePromptId;
	let disposed = false;
	let transitionInProgress = false;
	let navigationVersion = 0;
	let monitorHandle: RealtimeChannelHandle | null = null;

	function navigateOnce(url: string, version: number) {
		if (disposed || transitionInProgress || version !== navigationVersion) return;
		transitionInProgress = true;
		onNavigate(url);
	}

	// 次の滑走者プロンプトへ遷移する共通処理（realtime/polling 双方から呼ぶ）。
	async function navigateToPrompt(activePromptId: string) {
		const version = ++navigationVersion;
		const { data: promptData, error: promptError } = await supabase
			.from('scoring_prompts')
			.select('*')
			.eq('id', activePromptId)
			.maybeSingle();

		if (disposed || transitionInProgress || version !== navigationVersion) return;

		if (!promptError && promptData) {
			const { data: participant } = await supabase
				.from('participants')
				.select('id')
				.eq('session_id', sessionId)
				.eq('bib_number', promptData.bib_number)
				.maybeSingle();
			if (disposed || transitionInProgress || version !== navigationVersion) return;

			// #6: participant が解決できればそのまま、できなければ bib のみで input へ遷移する
			// （input 側が bib から participantId を解決/リダイレクトする）。
			const target = config.buildPromptUrl
				? config.buildPromptUrl(promptData, participant?.id ?? null)
				: participant
					? `/session/${sessionId}/score/${modeType}/${eventId}/input?bib=${promptData.bib_number}&participantId=${participant.id}`
					: `/session/${sessionId}/score/${modeType}/${eventId}/input?bib=${promptData.bib_number}`;
			onBibChange(promptData.bib_number);
			navigateOnce(target, version);
			return;
		}

		// #6: プロンプト自体が読めない場合もスコアベースへフォールバックし、停滞を防ぐ
		navigateOnce(
			config.promptFallbackUrl ?? `/session/${sessionId}/score/${modeType}/${eventId}`,
			version
		);
	}

	monitorHandle = createSessionMonitorWithPolling(supabase, {
		sessionId,
		channelPrefix: 'session-finalize',
		onRealtimePayload: async (payload: any) => {
			if (disposed || transitionInProgress) return;
			const newIsActive = payload.new.is_active;
			const newActivePromptId = payload.new.active_prompt_id;
			const previousActivePromptId = lastActivePromptId;

			// realtime が拾った変化を polling 側の基準にも反映（二重発火を防ぐ）。
			lastActivePromptId = newActivePromptId;

			// セッションが終了した場合
			if (newIsActive === false) {
				const version = ++navigationVersion;
				navigateOnce(endedUrl, version);
				return;
			}

			// 新しいactive_prompt_idが設定された場合（次の滑走者）
			if (newActivePromptId && newActivePromptId !== previousActivePromptId) {
				await navigateToPrompt(newActivePromptId);
				return;
			}

			// active_prompt_idがnullになったら、採点が確定された
			if (
				newActivePromptId === null &&
				previousActivePromptId !== null &&
				previousActivePromptId !== undefined
			) {
				const version = ++navigationVersion;
				navigateOnce(waitingUrl, version);
			}
		},
		// realtime 瞬断時の保険。realtime が落ちている間に起きた active_prompt 変化を拾う。
		onPollingData: async ({ is_active, active_prompt_id }) => {
			if (disposed || transitionInProgress) return;
			// 初回ポーリングは現在値をシードするだけ（誤遷移を防ぐ）。
			if (lastActivePromptId === undefined) {
				lastActivePromptId = active_prompt_id;
				return;
			}

			if (is_active === false) {
				const version = ++navigationVersion;
				navigateOnce(endedUrl, version);
				return;
			}

			if (active_prompt_id && active_prompt_id !== lastActivePromptId) {
				lastActivePromptId = active_prompt_id;
				await navigateToPrompt(active_prompt_id);
				return;
			}

			if (active_prompt_id === null && lastActivePromptId !== null) {
				lastActivePromptId = null;
				const version = ++navigationVersion;
				navigateOnce(waitingUrl, version);
			}
		}
	});

	return {
		cleanup: () => {
			if (disposed) return;
			disposed = true;
			navigationVersion++;
			monitorHandle?.cleanup();
		},
		getChannel: () => monitorHandle?.getChannel() ?? null
	};
}
