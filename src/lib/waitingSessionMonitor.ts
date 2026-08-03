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
	let previousPromptId = initialPromptId;
	let handle: RealtimeChannelWithRetryHandle | null = null;

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
			if (mode === 'training') {
				scoreQuery = scoreQuery.eq('judge_id', identity.userId);
			} else {
				const judgeName = identity.profileName || identity.userEmail || 'Unknown';
				scoreQuery = scoreQuery.eq('judge_name', judgeName);
			}
		}

		const { data } = await scoreQuery.maybeSingle();
		return Boolean(data);
	}

	async function navigateToPrompt(promptId: string, checkExistingScore: boolean) {
		const { data, error } = await supabase
			.from('scoring_prompts')
			.select('*')
			.eq('id', promptId)
			.single();
		const prompt = data as PromptData | null;

		if (error || !prompt) return;

		const mode = prompt.discipline;
		if (mode !== 'tournament' && mode !== 'training') {
			onBibChange(prompt.bib_number);
			previousPromptId = promptId;
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

		if (!participant) return;
		if (checkExistingScore && (await hasExistingScore(prompt, participant.id))) return;

		onBibChange(prompt.bib_number);
		previousPromptId = promptId;
		onNavigate(
			`/session/${sessionId}/score/${mode}/${prompt.level}/input?bib=${prompt.bib_number}&participantId=${participant.id}`
		);
	}

	function endSession() {
		if (!isPageActive() || isSessionEnded()) return;
		handle?.cleanup();
		onSessionEnded();
		onNavigate(`/session/${sessionId}?ended=true`);
	}

	async function pollSession() {
		if (!isPageActive()) return;

		const { data: session, error } = await supabase
			.from('sessions')
			.select('active_prompt_id, status')
			.eq('id', sessionId)
			.single();

		if (error || !session) return;
		if (session.status === 'ended') {
			endSession();
			return;
		}

		const newPromptId = session.active_prompt_id as string | null;
		if (newPromptId && newPromptId !== previousPromptId && !shouldShowJoinUI) {
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
			if (isSessionEnded()) return;
			if (payload.new.status === 'ended') {
				endSession();
				return;
			}

			const newPromptId = payload.new.active_prompt_id as string | null;
			if (newPromptId && payload.old.active_prompt_id !== newPromptId) {
				await navigateToPrompt(newPromptId, false);
			}
		},
		onSubscribed: async () => {
			if (initialPromptId && !shouldShowJoinUI) {
				await navigateToPrompt(initialPromptId, true);
			}
		}
	});

	return handle;
}
