import type { SupabaseClient } from '@supabase/supabase-js';
import { createRealtimeChannelWithRetry, type RealtimeChannelWithRetryHandle } from '$lib/realtime';
import { createSerializedAsync, type SerializedAsyncHandle } from '$lib/serializedAsync';

export interface ScoreEntry {
	judge_id?: string;
	guest_identifier?: string;
	judge_name: string;
	score: number;
	is_guest?: boolean;
}

export interface ScoreStatus {
	scores: ScoreEntry[];
	requiredJudges: number;
}

export interface ScoreStatusManagerConfig {
	supabase: SupabaseClient;
	sessionId: string;
	eventId: string;
	bib: string;
	isTrainingMode: boolean;
	totalJudges: number;
	eventInfo: { discipline: string; level: string; event_name: string };
	excludeExtremes: boolean;
	initialStatus: ScoreStatus;
	initialAthleteId: string | null;
	onStatusChange: (status: ScoreStatus) => void;
	onConnectionError: (hasError: boolean) => void;
}

export interface ScoreStatusManagerHandle {
	/** 名前キャッシュ初期化 */
	initializeNameCache(): Promise<void>;
	/** Realtime チャンネル開始 */
	setupRealtime(): void;
	/** 手動更新+再接続 */
	manualRefresh(): Promise<void>;
	/** 全リソース解放 */
	cleanup(): void;
	/** Realtime payload 用の名前解決 */
	getJudgeNameSync(score: { judge_id?: string; guest_identifier?: string }): string;
	/** athlete_id (研修モード Realtime フィルター) */
	getAthleteId(): string | null;
}

/** 採点状況の1回の取得に許す上限。超えたら錠を解放し、クエリを abort する */
const STATUS_FETCH_TIMEOUT_MS = 15000;

export function createScoreStatusManager(
	config: ScoreStatusManagerConfig
): ScoreStatusManagerHandle {
	const {
		supabase,
		sessionId,
		eventId,
		bib,
		isTrainingMode,
		totalJudges,
		eventInfo,
		onStatusChange,
		onConnectionError
	} = config;

	let currentStatus: ScoreStatus = { ...config.initialStatus };
	let athleteId: string | null = config.initialAthleteId;

	const judgeNameCache = new Map<string, string>();
	const guestNameCache = new Map<string, string>();

	let scoreRealtimeHandle: RealtimeChannelWithRetryHandle | null = null;
	let serializedFetch: SerializedAsyncHandle | null = null;

	// --- 名前キャッシュ ---

	async function initializeNameCache(): Promise<void> {
		console.log('[scoreStatusManager/cache] Judge名キャッシュを初期化中...');

		// session_participants → profiles は FK 関係が無く、PostgREST の埋め込み
		// (profiles:judge_id(full_name)) が 400 になる。judge_id を取得してから profiles を
		// IN 句で引く方式に統一する（fetchStatusImpl の研修パスと同じ・埋め込み不要）。
		const { data: judges } = await supabase
			.from('session_participants')
			.select('judge_id')
			.eq('session_id', sessionId)
			.not('judge_id', 'is', null);

		const judgeIds = (judges || []).map((j: any) => j.judge_id).filter(Boolean);
		if (judgeIds.length > 0) {
			const { data: profiles } = await supabase
				.from('profiles')
				.select('id, full_name')
				.in('id', judgeIds);

			if (profiles) {
				profiles.forEach((p: any) => {
					if (p.id && p.full_name) {
						judgeNameCache.set(p.id, p.full_name);
					}
				});
			}
		}

		const { data: guests } = await supabase
			.from('session_participants')
			.select('guest_identifier, guest_name')
			.eq('session_id', sessionId)
			.not('guest_identifier', 'is', null);

		if (guests) {
			guests.forEach((g: any) => {
				if (g.guest_identifier && g.guest_name) {
					guestNameCache.set(g.guest_identifier, g.guest_name);
				}
			});
		}

		console.log('[scoreStatusManager/cache] キャッシュ初期化完了:', {
			judges: judgeNameCache.size,
			guests: guestNameCache.size
		});
	}

	function getJudgeNameSync(score: { judge_id?: string; guest_identifier?: string }): string {
		if (score.guest_identifier) {
			return guestNameCache.get(score.guest_identifier) || 'ゲスト';
		} else if (score.judge_id) {
			return judgeNameCache.get(score.judge_id) || '不明';
		}
		return '不明';
	}

	// --- スコア取得 ---

	function updateStatus(status: ScoreStatus) {
		currentStatus = status;
		onStatusChange(status);
	}

	async function fetchStatusImpl(signal?: AbortSignal): Promise<void> {
		if (!bib) {
			console.error('❌ Bib number is missing');
			return;
		}

		console.log('[scoreStatusManager] fetchStatus実行:', { isTrainingMode, eventId, bib });

		if (isTrainingMode) {
			const { data: participant } = await supabase
				.from('participants')
				.select('id')
				.eq('session_id', sessionId)
				.eq('bib_number', parseInt(bib))
				.abortSignal(signal!)
				.maybeSingle();

			if (!participant) {
				console.error('❌ Participant not found');
				return;
			}

			athleteId = participant.id;
			console.log('[scoreStatusManager] athlete_id保存:', athleteId);

			// 研修の N（参加者数）をライブ取得して進捗表示に使う（凍結 config 値の代わり）。
			// ソフトゲート＝表示専用なので、status 更新ごとに最新の参加者数へ追従させる。
			const { count: participantCount } = await supabase
				.from('session_participants')
				.select('*', { count: 'exact', head: true })
				.abortSignal(signal!)
				.eq('session_id', sessionId);
			const liveRequired = participantCount || totalJudges || 1;

			const { data: trainingScores, error: scoresError } = await supabase
				.from('training_scores')
				.select('id, score, judge_id, guest_identifier')
				.eq('event_id', eventId)
				.abortSignal(signal!)
				.eq('athlete_id', participant.id);

			console.log('[scoreStatusManager] training_scores取得:', { trainingScores, scoresError });

			if (trainingScores && trainingScores.length > 0) {
				const judgeIds = trainingScores.filter((s: any) => s.judge_id).map((s: any) => s.judge_id);

				const guestIdentifiers = trainingScores
					.filter((s: any) => s.guest_identifier)
					.map((s: any) => s.guest_identifier);

				let judgeNames: Record<string, string> = {};
				if (judgeIds.length > 0) {
					const { data: profiles } = await supabase
						.from('profiles')
						.select('id, full_name')
						.abortSignal(signal!)
						.in('id', judgeIds);

					if (profiles) {
						judgeNames = Object.fromEntries(
							profiles.map((p: any) => [p.id, p.full_name || '不明'])
						);
						profiles.forEach((p: any) => {
							if (p.id && p.full_name) {
								judgeNameCache.set(p.id, p.full_name);
							}
						});
					}
				}

				let guestNames: Record<string, string> = {};
				if (guestIdentifiers.length > 0) {
					const { data: guests } = await supabase
						.from('session_participants')
						.select('guest_identifier, guest_name')
						.abortSignal(signal!)
						.in('guest_identifier', guestIdentifiers);

					if (guests) {
						guestNames = Object.fromEntries(
							guests.map((g: any) => [g.guest_identifier, g.guest_name || 'ゲスト'])
						);
						guests.forEach((g: any) => {
							if (g.guest_identifier && g.guest_name) {
								guestNameCache.set(g.guest_identifier, g.guest_name);
							}
						});
					}
				}

				const scoresWithNames = trainingScores.map((s: any) => ({
					judge_id: s.judge_id,
					guest_identifier: s.guest_identifier,
					judge_name: s.guest_identifier
						? guestNames[s.guest_identifier] || 'ゲスト'
						: judgeNames[s.judge_id] || '不明',
					score: s.score,
					is_guest: !!s.guest_identifier
				}));

				updateStatus({
					scores: scoresWithNames,
					requiredJudges: liveRequired
				});
			} else {
				updateStatus({
					scores: [],
					requiredJudges: liveRequired
				});
			}
		} else {
			const url = `/api/score-status/${sessionId}/${bib}?discipline=${encodeURIComponent(eventInfo.discipline)}&level=${encodeURIComponent(eventInfo.level)}&event=${encodeURIComponent(eventInfo.event_name)}`;

			const response = await fetch(url, { signal });

			if (response.ok) {
				const result = await response.json();
				// 必要採点数は API がモード別に算出済み（大会=exclude_extremes→3/5、検定=required_judges）。
				// クライアントで上書きしない（検定でも正しい値になる）。
				updateStatus({
					...result
				});
			} else {
				const errorText = await response.text();
				console.error('❌ API Error:', response.status, errorText);
			}
		}
	}

	// --- Realtime ペイロード処理 ---

	function handleTrainingScorePayload(payload: any) {
		const payloadAthleteId = payload.new?.athlete_id || payload.old?.athlete_id;
		if (!athleteId || (payloadAthleteId && payloadAthleteId !== athleteId)) {
			return;
		}

		if (payload.eventType === 'INSERT') {
			const judgeName = getJudgeNameSync(payload.new);
			const newScore: ScoreEntry = {
				judge_id: payload.new.judge_id,
				guest_identifier: payload.new.guest_identifier,
				judge_name: judgeName,
				score: payload.new.score,
				is_guest: !!payload.new.guest_identifier
			};

			const existingIndex = currentStatus.scores.findIndex((s) => {
				if (payload.new.guest_identifier) {
					return s.guest_identifier === payload.new.guest_identifier;
				} else {
					return s.judge_id === payload.new.judge_id;
				}
			});

			// Immutable update — never mutate currentStatus.scores in place
			const newScores =
				existingIndex !== -1
					? currentStatus.scores.map((s, i) => (i === existingIndex ? newScore : s))
					: [...currentStatus.scores, newScore];

			updateStatus({ ...currentStatus, scores: newScores });
		} else if (payload.eventType === 'UPDATE') {
			updateStatus({
				...currentStatus,
				scores: currentStatus.scores.map((s) => {
					if (payload.new.guest_identifier) {
						return s.guest_identifier === payload.new.guest_identifier
							? { ...s, score: payload.new.score }
							: s;
					} else {
						return s.judge_id === payload.new.judge_id ? { ...s, score: payload.new.score } : s;
					}
				})
			});
		} else if (payload.eventType === 'DELETE') {
			// ⚠️ DELETE の payload.old は当てにできない。Supabase 公式ドキュメント:
			//   "RLS policies are not applied to DELETE statements... When RLS is enabled and
			//    replica identity is set to full on a table, the old record contains only the
			//    primary key(s)."
			// RLS 有効なテーブルでは REPLICA IDENTITY FULL にしても主キーしか届かないため、
			// guest_identifier / judge_id での絞り込みは成立しない（以前はここで絞っており、
			// 採点削除が即時反映されずヘルスポーリング頼みになっていた）。
			// payload に頼らず正規状態を取り直す。削除は稀なのでコストも問題にならない。
			fetchStatus();
		}
	}

	function handleTournamentScorePayload(payload: any) {
		const discipline = eventInfo.discipline || '';
		const level = eventInfo.level || '';
		const eventName = eventInfo.event_name || '';

		let shouldUpdate = false;
		if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
			if (
				payload.new?.discipline === discipline &&
				payload.new?.level === level &&
				payload.new?.event_name === eventName
			) {
				shouldUpdate = true;
			}
		} else if (payload.eventType === 'DELETE') {
			// ⚠️ DELETE の payload.old には主キーしか入らない（RLS 有効時の Supabase 仕様）。
			// discipline / level / event_name での判定は常に false になるため、
			// 絞り込まずに再取得する。チャンネルは session_id + bib で購読済みなので、
			// 無関係なイベントで無駄な再取得が多発することはない。
			{
				shouldUpdate = true;
			}
		}

		if (shouldUpdate) {
			fetchStatus();
		}
	}

	// --- 排他制御 ---

	// ⚠️ 期限はここ（実クエリを実行する側）に置く。
	// 外側の realtime ポーリングだけに期限を置いても、pollingFn が投げっぱなしだと
	// 即座に解決する Promise を監視するだけで実クエリを見張れない。
	serializedFetch = createSerializedAsync(fetchStatusImpl, {
		pendingDelayMs: 100,
		timeoutMs: STATUS_FETCH_TIMEOUT_MS
	});

	// Fire-and-forget fetch (realtime payload ハンドラ用。応答を待つ必要がない経路)
	function fetchStatus(): Promise<void> {
		serializedFetch!.run();
		return Promise.resolve();
	}

	// ポーリング用。**実際の取得完了を待つ**ことで、呼び出し側（realtime の期限）が
	// 実クエリを監視できるようにする。投げっぱなしにすると期限が意味を成さない。
	function pollStatus(): Promise<void> {
		return serializedFetch!.runAsync();
	}

	// Awaitable fetch that respects serialization (for manualRefresh)
	function fetchStatusAwaitable(): Promise<void> {
		return serializedFetch!.runAsync();
	}

	// --- Realtime セットアップ ---

	function setupRealtime() {
		if (isTrainingMode) {
			scoreRealtimeHandle = createRealtimeChannelWithRetry(supabase, {
				channelName: `training-scores-${eventId}-${bib}`,
				table: 'training_scores',
				filter: `event_id=eq.${eventId}`,
				pollingFn: pollStatus,
				// 現場では「点が入ったか」をこの画面で見る。Realtime に繋がらないときは
				// 再購読の上限（5回・約31秒のバックオフ＋接続タイムアウト）を待たず、
				// すぐポーリングへ切り替える。待機画面・スコアボードと同じ扱い。
				startPollingImmediately: true,
				startPollingOnErrorStatus: true,
				onConnectionError: (hasError) => {
					onConnectionError(hasError);
				},
				onPayload: handleTrainingScorePayload
			});
		} else {
			scoreRealtimeHandle = createRealtimeChannelWithRetry(supabase, {
				channelName: `results-${sessionId}-${bib}`,
				table: 'results',
				filter: `session_id=eq.${sessionId},bib=eq.${parseInt(bib || '0')}`,
				pollingFn: pollStatus,
				// 現場では「点が入ったか」をこの画面で見る。Realtime に繋がらないときは
				// 再購読の上限（5回・約31秒のバックオフ＋接続タイムアウト）を待たず、
				// すぐポーリングへ切り替える。待機画面・スコアボードと同じ扱い。
				startPollingImmediately: true,
				startPollingOnErrorStatus: true,
				onConnectionError: (hasError) => {
					onConnectionError(hasError);
				},
				onPayload: handleTournamentScorePayload
			});
		}
	}

	// --- パブリック API ---

	return {
		initializeNameCache,
		setupRealtime,
		async manualRefresh() {
			// Use the awaitable serialized path so we both respect the
			// exclusion lock AND wait for the actual fetch to complete
			// before the channel reconnects.
			await scoreRealtimeHandle?.manualRefresh(fetchStatusAwaitable);
		},
		cleanup() {
			scoreRealtimeHandle?.cleanup();
			serializedFetch?.cleanup();
		},
		getJudgeNameSync,
		getAthleteId: () => athleteId
	};
}
