import type { SupabaseClient } from '@supabase/supabase-js';
import { createRealtimeChannelWithRetry, type RealtimeChannelWithRetryHandle } from '$lib/realtime';

interface WaitingSessionIdentity {
	guestIdentifier: string | null;
	userId: string | null;
	userEmail: string | null;
	profileName: string | null;
}

export interface WaitingSessionMonitorConfig {
	supabase: SupabaseClient;
	sessionId: string | number;
	initialPromptId: string | null;
	shouldShowJoinUI: boolean;
	identity: WaitingSessionIdentity;
	isPageActive: () => boolean;
	isSessionEnded: () => boolean;
	onSessionEnded: () => void;
	onBibChange: (bib: number) => void;
	onNavigate: (url: string) => void;
}

type PromptData = {
	id: string;
	bib_number: number;
	discipline: string;
	level: string;
	event_name: string;
};

/**
 * セッション待機画面の監視を一か所に集約する。
 * Realtime とフォールバックポーリングは同じ prompt 処理を通るため、
 * モード別遷移や既存採点チェックの差分が生じない。
 */
export function createWaitingSessionMonitor(
	config: WaitingSessionMonitorConfig
): RealtimeChannelWithRetryHandle {
	const {
		supabase,
		sessionId,
		initialPromptId,
		shouldShowJoinUI,
		identity,
		isPageActive,
		isSessionEnded,
		onSessionEnded,
		onBibChange,
		onNavigate
	} = config;
	let latestPromptId = initialPromptId;
	let hasCheckedCurrentPrompt = false;
	let promptRequestVersion = 0;
	let transitionInProgress = false;
	let disposed = false;
	let handle: RealtimeChannelWithRetryHandle | null = null;

	function isMonitorActive() {
		return !disposed && isPageActive();
	}

	async function hasExistingScore(prompt: PromptData, participantId: string | number) {
		const mode = prompt.discipline;
		let scoreQuery = supabase
			.from(mode === 'training' ? 'training_scores' : 'results')
			.select('id');

		if (mode === 'training') {
			scoreQuery = scoreQuery.eq('event_id', prompt.level).eq('athlete_id', participantId);
		} else {
			scoreQuery = scoreQuery.eq('session_id', sessionId).eq('bib', prompt.bib_number);
		}

		if (identity.guestIdentifier) {
			scoreQuery = scoreQuery.eq('guest_identifier', identity.guestIdentifier);
		} else if (identity.userId) {
			// 表示名は重複・変更されうるため、全モードで不変の所有者IDを使う。
			scoreQuery = scoreQuery.eq('judge_id', identity.userId);
		}

		const { data, error } = await scoreQuery.maybeSingle();
		if (error) return null;
		return Boolean(data);
	}

	async function navigateToPrompt(promptId: string, checkExistingScore: boolean) {
		const requestVersion = ++promptRequestVersion;
		latestPromptId = promptId;
		const isCurrentRequest = () =>
			isMonitorActive() && requestVersion === promptRequestVersion && !transitionInProgress;
		const allowRetry = () => {
			if (requestVersion === promptRequestVersion && latestPromptId === promptId) {
				latestPromptId = null;
			}
		};

		const { data, error } = await supabase
			.from('scoring_prompts')
			.select('*')
			.eq('id', promptId)
			.single();
		const prompt = data as PromptData | null;

		if (!isCurrentRequest()) return;
		if (error || !prompt) {
			allowRetry();
			return;
		}

		const mode = prompt.discipline;
		if (mode !== 'tournament' && mode !== 'training') {
			if (!isCurrentRequest()) return;
			onBibChange(prompt.bib_number);
			transitionInProgress = true;
			onNavigate(
				`/session/${sessionId}/${prompt.discipline}/${prompt.level}/${prompt.event_name}/score`
			);
			return;
		}

		const { data: participant } = await supabase
			.from('participants')
			.select('id')
			.eq('session_id', sessionId)
			.eq('bib_number', prompt.bib_number)
			.maybeSingle();

		if (!isCurrentRequest()) return;
		if (!participant) {
			allowRetry();
			return;
		}
		if (checkExistingScore) {
			const alreadyScored = await hasExistingScore(prompt, participant.id);
			if (!isCurrentRequest()) return;
			if (alreadyScored === null) {
				allowRetry();
				return;
			}
			if (alreadyScored) return;
		}

		onBibChange(prompt.bib_number);
		transitionInProgress = true;
		onNavigate(
			`/session/${sessionId}/score/${mode}/${prompt.level}/input?bib=${prompt.bib_number}&participantId=${participant.id}`
		);
	}

	function cleanupMonitor() {
		if (disposed) return;
		disposed = true;
		promptRequestVersion++;
		handle?.cleanup();
	}

	function endSession() {
		if (!isMonitorActive() || isSessionEnded() || transitionInProgress) return;
		transitionInProgress = true;
		cleanupMonitor();
		onSessionEnded();
		onNavigate(`/session/${sessionId}?ended=true`);
	}

	function resumeSession() {
		if (!isMonitorActive() || !isSessionEnded() || transitionInProgress) return;
		transitionInProgress = true;
		promptRequestVersion++;
		onNavigate(`/session/${sessionId}`);
	}

	async function pollSession() {
		if (!isMonitorActive()) return;

		const { data: session, error } = await supabase
			.from('sessions')
			.select('active_prompt_id, status')
			.eq('id', sessionId)
			.single();

		if (!isMonitorActive() || error || !session) return;
		if (session.status === 'ended') {
			endSession();
			return;
		}
		if (isSessionEnded()) {
			resumeSession();
			return;
		}

		const newPromptId = session.active_prompt_id as string | null;
		const shouldProcessPrompt =
			newPromptId &&
			(!hasCheckedCurrentPrompt || newPromptId !== latestPromptId) &&
			!shouldShowJoinUI;
		hasCheckedCurrentPrompt = true;
		if (shouldProcessPrompt) {
			await navigateToPrompt(newPromptId, true);
		}
	}

	handle = createRealtimeChannelWithRetry(supabase, {
		channelName: `session-status-${sessionId}`,
		table: 'sessions',
		event: 'UPDATE',
		filter: `id=eq.${sessionId}`,
		pollingIntervalMs: 3000,
		pollingFn: pollSession,
		startPollingImmediately: true,
		startPollingOnErrorStatus: true,
		onPayload: async (payload) => {
			if (!isMonitorActive()) return;
			if (payload.new.status === 'ended') {
				endSession();
				return;
			}
			if (isSessionEnded()) {
				resumeSession();
				return;
			}

			const newPromptId = payload.new.active_prompt_id as string | null;
			if (newPromptId && newPromptId !== latestPromptId && !shouldShowJoinUI) {
				hasCheckedCurrentPrompt = true;
				await navigateToPrompt(newPromptId, false);
			}
		},
		onSubscribed: async () => {
			// 再接続時に起動時の prompt を再生せず、現在のDB状態を正として同期する。
			await pollSession();
		}
	});

	return {
		cleanup: cleanupMonitor,
		getChannel: () => handle?.getChannel() ?? null,
		hasConnectionError: () => handle?.hasConnectionError() ?? false,
		manualRefresh: async (refreshFn) => {
			if (!isMonitorActive()) return;
			await handle?.manualRefresh(refreshFn);
		}
	};
}
