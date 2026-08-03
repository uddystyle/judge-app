import type { SupabaseClient } from '@supabase/supabase-js';
import { authenticateAction } from '$lib/server/sessionAuth';
import {
	getJudgeName,
	fetchSessionDetails,
	isChiefJudge,
	getMultiJudgeMode
} from '$lib/server/sessionHelpers';
import { validateBib, validateScoreInput, validateScoreRange } from '$lib/server/validation';
import { isRetryableReason, RETRYABLE_REASONS } from '$lib/syncContract';
import { logger } from '$lib/server/logger';

/**
 * オフライン採点同期（network-resilience-strategy.md Phase 2）
 *
 * クライアントが IndexedDB キューから送る score mutation を、
 * 既存の採点アクション（kentei score / [modeType] input）と同じ検証・
 * 保存セマンティクスで1件ずつ処理する。
 *
 * 冪等性: client_mutation_id を score_mutations（migration 1024）に記録し、
 * 同じ mutation の再送には記録済みの結果を返す。
 *
 * 拒否理由の分類:
 * - 恒久的拒否（記録する。クライアントは再送しない）: validation_failed /
 *   mode_mismatch / event_not_found / participant_not_found /
 *   score_out_of_range / name_collision / no_matching_prompt
 * - session_not_found: 恒久的拒否だが、sessions FK の制約上 mutation log には
 *   記録できない（クライアント側で rejected になるため再送はされない）
 * - 一時的失敗（記録しない。クライアントはキューに保持して再送する）:
 *   auth_required / save_failed — 定義は $lib/syncContract.ts（クライアントと共有）
 */

export { RETRYABLE_REASONS };

export interface ScoreMutationInput {
	client_mutation_id?: unknown;
	session_id?: unknown;
	mode_type?: unknown;
	event_id?: unknown;
	discipline?: unknown;
	level?: unknown;
	event_name?: unknown;
	bib_number?: unknown;
	score?: unknown;
	owner_type?: unknown;
	judge_id?: unknown;
	guest_identifier?: unknown;
	created_at_local?: unknown;
}

export type ScoreMutationOutcome = { accepted: true } | { accepted: false; reason: string };

const VALID_MODES = ['certification', 'tournament', 'training'] as const;
export type ScoreModeType = (typeof VALID_MODES)[number];

const CLIENT_MUTATION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function reject(reason: string): ScoreMutationOutcome {
	return { accepted: false, reason };
}

interface MutationRecord {
	client_mutation_id: string;
	session_id: number;
	mode_type: ScoreModeType;
	event_id: number | null;
	bib_number: number;
	score: number;
	judge_id: string | null;
	guest_identifier: string | null;
	created_at_local: string | null;
	payload: unknown;
}

/**
 * mutation log に記録しない拒否理由。
 * - session_not_found: sessions FK により記録不能
 * - guest_identity_mismatch / auth_identity_mismatch: 記録すると冪等チェックが拒否を
 *   永久に返し、正しい identity で再採用（P3）して再送しても評価されず救済不能になる。
 *   これらは非 RETRYABLE（クライアントは自動再送しない）なので churn は起きず、
 *   rependMismatchedMutations による意図的な再送のみが owner ガードで再評価される。
 */
const UNRECORDED_REJECT_REASONS = new Set([
	'session_not_found',
	'guest_identity_mismatch',
	'auth_identity_mismatch'
]);

/**
 * 恒久的な結果のみを mutation log に記録する。
 * - 一時的失敗（RETRYABLE_REASONS）は記録しない（記録すると冪等チェックが
 *   その拒否を永久に返し、再送が二度と適用されなくなる）
 * - UNRECORDED_REJECT_REASONS も記録しない（上記コメント参照）
 */
async function recordOutcome(
	supabaseAdmin: SupabaseClient,
	mutation: MutationRecord,
	outcome: ScoreMutationOutcome
): Promise<ScoreMutationOutcome> {
	if (
		!outcome.accepted &&
		(isRetryableReason(outcome.reason) || UNRECORDED_REJECT_REASONS.has(outcome.reason))
	) {
		return outcome;
	}

	const { error } = await supabaseAdmin.from('score_mutations').insert({
		client_mutation_id: mutation.client_mutation_id,
		session_id: mutation.session_id,
		mode_type: mutation.mode_type,
		event_id: mutation.event_id,
		bib_number: mutation.bib_number,
		score: mutation.score,
		judge_id: mutation.judge_id,
		guest_identifier: mutation.guest_identifier,
		created_at_local: mutation.created_at_local,
		payload: mutation.payload,
		status: outcome.accepted ? 'accepted' : 'rejected',
		rejection_reason: outcome.accepted ? null : outcome.reason
	});

	if (error) {
		if (error.code === '23505') {
			// 同一 mutation の並行処理: 先勝ちの記録を返す
			const { data: existing } = await supabaseAdmin
				.from('score_mutations')
				.select('status, rejection_reason')
				.eq('client_mutation_id', mutation.client_mutation_id)
				.maybeSingle();
			if (existing) {
				return existing.status === 'accepted'
					? { accepted: true }
					: reject(existing.rejection_reason || 'rejected');
			}
		}
		// 記録に失敗しても採点適用は完了している（採点は owner ベース upsert のため
		// 再送されても同値上書きで無害）。結果はそのまま返す
		logger.error('[scoreSync] mutation log の記録に失敗:', error);
	}

	return outcome;
}

export interface AcceptedScoreMutationInput {
	client_mutation_id: unknown;
	session_id: number;
	mode_type: ScoreModeType;
	event_id: number | null;
	bib_number: number;
	score: number;
	judge_id: string | null;
	guest_identifier: string | null;
	payload?: unknown;
}

/**
 * オンライン action で保存済みの採点を mutation log に記録する。
 * IndexedDB が使えず ID が無い場合は何もしない。ログ障害で保存済み採点を
 * 失敗扱いにしないため、記録エラーは recordOutcome 内でログに留める。
 */
export async function recordAcceptedScoreMutation(
	supabaseAdmin: SupabaseClient | undefined,
	input: AcceptedScoreMutationInput
): Promise<void> {
	const clientMutationId =
		typeof input.client_mutation_id === 'string' ? input.client_mutation_id : '';
	if (!supabaseAdmin || !CLIENT_MUTATION_ID_RE.test(clientMutationId)) return;

	await recordOutcome(
		supabaseAdmin,
		{
			client_mutation_id: clientMutationId,
			session_id: input.session_id,
			mode_type: input.mode_type,
			event_id: input.event_id,
			bib_number: input.bib_number,
			score: input.score,
			judge_id: input.judge_id,
			guest_identifier: input.guest_identifier,
			created_at_local: null,
			payload: input.payload ?? { source: 'online_action' }
		},
		{ accepted: true }
	);
}

/**
 * mutation を1件処理する。
 * 戻り値が accepted / 恒久的拒否なら処理済みとして記録済み（session_not_found を除く）。
 * RETRYABLE_REASONS の拒否は記録されず、クライアントが再送してよい。
 */
export async function processScoreMutation(
	supabase: SupabaseClient,
	supabaseAdmin: SupabaseClient,
	input: ScoreMutationInput
): Promise<ScoreMutationOutcome> {
	// ============================================================
	// 1. 形式バリデーション
	// ============================================================
	const clientMutationId =
		typeof input.client_mutation_id === 'string' ? input.client_mutation_id : '';
	if (!CLIENT_MUTATION_ID_RE.test(clientMutationId)) {
		return reject('validation_failed');
	}

	const sessionIdNum = Number.parseInt(String(input.session_id), 10);
	if (!Number.isInteger(sessionIdNum) || sessionIdNum < 1) {
		return reject('validation_failed');
	}
	const sessionId = String(sessionIdNum);

	const modeType = String(input.mode_type ?? '') as ScoreModeType;
	if (!VALID_MODES.includes(modeType)) {
		return reject('validation_failed');
	}

	const bibResult = validateBib(String(input.bib_number ?? ''));
	if (!bibResult.success) {
		return reject('validation_failed');
	}
	const bibNumber = bibResult.value;

	const scoreResult = validateScoreInput(String(input.score ?? ''));
	if (!scoreResult.success) {
		return reject('validation_failed');
	}
	const score = scoreResult.value;

	const guestIdentifierRaw =
		typeof input.guest_identifier === 'string' && input.guest_identifier
			? input.guest_identifier
			: null;
	const judgeIdRaw = typeof input.judge_id === 'string' && input.judge_id ? input.judge_id : null;
	const createdAtLocal =
		typeof input.created_at_local === 'string' && !Number.isNaN(Date.parse(input.created_at_local))
			? input.created_at_local
			: null;

	// ============================================================
	// 2. 冪等性: 処理済みならその結果を返す
	// ============================================================
	const { data: processed, error: processedError } = await supabaseAdmin
		.from('score_mutations')
		.select('status, rejection_reason')
		.eq('client_mutation_id', clientMutationId)
		.maybeSingle();

	if (processedError) {
		logger.error('[scoreSync] 処理済み確認に失敗:', processedError);
		return reject('save_failed');
	}
	if (processed) {
		return processed.status === 'accepted'
			? { accepted: true }
			: reject(processed.rejection_reason || 'rejected');
	}

	// ============================================================
	// 3. セッション認証（既存アクションと同じ authenticateAction）
	// ============================================================
	const authResult = await authenticateAction(supabase, sessionId, guestIdentifierRaw);
	if (!authResult) {
		// 一時的失敗（JWT 失効等）。記録せず、クライアントはキュー保持して再送する
		return reject('auth_required');
	}
	const { user, guestParticipant } = authResult;

	const eventIdNum = input.event_id != null ? Number.parseInt(String(input.event_id), 10) : null;

	const authGuestIdentifier = guestParticipant ? guestParticipant.guest_identifier : null;
	const authJudgeId = guestParticipant ? null : (user?.id ?? null);

	const record: MutationRecord = {
		client_mutation_id: clientMutationId,
		session_id: sessionIdNum,
		mode_type: modeType,
		event_id: Number.isInteger(eventIdNum) ? eventIdNum : null,
		bib_number: bibNumber,
		score,
		judge_id: authJudgeId,
		guest_identifier: authGuestIdentifier,
		created_at_local: createdAtLocal,
		payload: input as unknown
	};

	// ============================================================
	// 4. セッション整合（モード一致）
	// 一時的なクエリエラーは not_found と区別し save_failed（未記録・再送可）にする
	// ============================================================
	const { data: session, error: sessionError } = await supabase
		.from('sessions')
		.select('id, mode, is_tournament_mode, chief_judge_id')
		.eq('id', sessionIdNum)
		.maybeSingle();

	if (sessionError) {
		logger.error('[scoreSync] セッション取得エラー:', sessionError);
		return reject('save_failed');
	}
	if (!session) {
		return recordOutcome(supabaseAdmin, record, reject('session_not_found'));
	}

	// ============================================================
	// 4.5 owner 帰属ガード（クロス帰属の防止）
	// mutation が主張する owner（enqueue 時に採点者本人の JWT 検証済み
	// judge_id / guest_identifier）と、同期時に認証された principal の owner が
	// 一致しなければ恒久拒否する。保存 owner は常に認証側=権威なので、食い違う採点は
	// サイレント誤保存せず明示拒否し「同期失敗」として表面化させる。
	// session 存在確認の後に置く（score_mutations.session_id FK を満たすため）。
	// ============================================================
	if (authGuestIdentifier) {
		if (guestIdentifierRaw !== authGuestIdentifier || judgeIdRaw !== null) {
			return recordOutcome(supabaseAdmin, record, reject('guest_identity_mismatch'));
		}
	} else if (!authJudgeId || judgeIdRaw !== authJudgeId || guestIdentifierRaw !== null) {
		return recordOutcome(supabaseAdmin, record, reject('auth_identity_mismatch'));
	}

	const sessionMode: ScoreModeType =
		session.mode === 'training'
			? 'training'
			: session.is_tournament_mode || session.mode === 'tournament'
				? 'tournament'
				: 'certification';
	if (sessionMode !== modeType) {
		return recordOutcome(supabaseAdmin, record, reject('mode_mismatch'));
	}

	// ============================================================
	// 5. モード別の検証・保存
	// ============================================================
	try {
		if (modeType === 'training' || modeType === 'tournament') {
			if (!record.event_id) {
				return recordOutcome(supabaseAdmin, record, reject('event_not_found'));
			}

			// 多審制の一般検定員は、そのセッションの採点指示に存在する対象のみ受理
			// （オンラインの #4.5 / M3 ゲートの同期版。同期遅延は受理・無関係な対象は拒否）
			const promptCheck = await verifyPromptMembership(supabase, {
				sessionId,
				modeType,
				user,
				guestParticipant,
				match: (q) => q.eq('bib_number', bibNumber).eq('level', String(record.event_id))
			});
			if (!promptCheck.accepted) {
				return recordOutcome(supabaseAdmin, record, promptCheck);
			}

			if (modeType === 'training') {
				return await recordOutcome(
					supabaseAdmin,
					record,
					await applyTrainingScore(supabase, {
						sessionId,
						eventId: record.event_id,
						bibNumber,
						score,
						judgeId: user?.id ?? null,
						guestIdentifier: guestParticipant?.guest_identifier ?? null
					})
				);
			}

			// tournament: 参加者は事前登録必須（input アクション #4 と同じく未登録 bib は拒否）
			const participantCheck = await findParticipant(supabase, sessionId, bibNumber);
			if (!participantCheck.ok) {
				return participantCheck.retryable
					? reject('save_failed')
					: recordOutcome(supabaseAdmin, record, reject('participant_not_found'));
			}

			return await recordOutcome(
				supabaseAdmin,
				record,
				await applyResultScore(supabase, {
					sessionIdNum,
					bibNumber,
					score,
					maxScore: 100, // 大会モードは 0-100（input アクションと同じ）
					user,
					guestParticipant,
					resolveEvent: async () => {
						const { data: eventData, error: eventError } = await supabase
							.from('custom_events')
							.select('discipline, level, event_name')
							.eq('id', record.event_id)
							.eq('session_id', sessionId)
							.maybeSingle();
						if (eventError) {
							logger.error('[scoreSync] custom_events 取得エラー:', eventError);
							throw new TransientLookupError();
						}
						return eventData ?? null;
					}
				})
			);
		}

		// certification: mutation が discipline/level/event_name を直接持つ
		const discipline = typeof input.discipline === 'string' ? input.discipline.trim() : '';
		const level = typeof input.level === 'string' ? input.level.trim() : '';
		const eventName = typeof input.event_name === 'string' ? input.event_name.trim() : '';
		if (
			!discipline ||
			!level ||
			!eventName ||
			discipline.length > 100 ||
			level.length > 100 ||
			eventName.length > 200
		) {
			return recordOutcome(supabaseAdmin, record, reject('validation_failed'));
		}

		// 多審制の一般検定員: M3 ゲートと同じ4項目（bib/discipline/level/event_name）で照合
		const promptCheck = await verifyPromptMembership(supabase, {
			sessionId,
			modeType,
			user,
			guestParticipant,
			match: (q) =>
				q
					.eq('bib_number', bibNumber)
					.eq('discipline', discipline)
					.eq('level', level)
					.eq('event_name', eventName)
		});
		if (!promptCheck.accepted) {
			return recordOutcome(supabaseAdmin, record, promptCheck);
		}

		// 検定モードは未登録 bib の参加者を自動作成する（kentei アクションと同じ）
		const ensured = await ensureParticipantExists(supabase, sessionId, bibNumber);
		if (!ensured) {
			return reject('save_failed');
		}

		return await recordOutcome(
			supabaseAdmin,
			record,
			await applyResultScore(supabase, {
				sessionIdNum,
				bibNumber,
				score,
				maxScore: 99, // 検定モードは 0-99 固定（kentei アクションと同じ）
				user,
				guestParticipant,
				resolveEvent: async () => ({ discipline, level, event_name: eventName })
			})
		);
	} catch (err) {
		if (!(err instanceof TransientLookupError)) {
			logger.error('[scoreSync] 予期しないエラー:', err);
		}
		return reject('save_failed');
	}
}

/** 参照クエリの一時的エラーを save_failed へ変換するための内部例外 */
class TransientLookupError extends Error {}

// ============================================================
// 内部: 参加者の存在確認 / 自動作成
// ============================================================
async function findParticipant(
	supabase: SupabaseClient,
	sessionId: string,
	bibNumber: number
): Promise<{ ok: true; id: string } | { ok: false; retryable: boolean }> {
	const { data: participant, error } = await supabase
		.from('participants')
		.select('id')
		.eq('session_id', sessionId)
		.eq('bib_number', bibNumber)
		.maybeSingle();

	if (error) {
		logger.error('[scoreSync] participants 取得エラー:', error);
		return { ok: false, retryable: true };
	}
	if (!participant) {
		return { ok: false, retryable: false };
	}
	return { ok: true, id: participant.id };
}

/** 検定モード: 未登録 bib は自動作成（kentei アクションと同じ）。失敗は false（save_failed 扱い） */
async function ensureParticipantExists(
	supabase: SupabaseClient,
	sessionId: string,
	bibNumber: number
): Promise<boolean> {
	const found = await findParticipant(supabase, sessionId, bibNumber);
	if (found.ok) return true;
	if (found.retryable) return false;

	const { error: createError } = await supabase.from('participants').insert({
		session_id: sessionId,
		bib_number: bibNumber,
		athlete_name: `選手${bibNumber}`
	});
	if (createError && createError.code !== '23505') {
		// 23505 は並行作成（他の検定員が同時に自動作成）— 存在するので OK
		logger.error('[scoreSync] 参加者の自動作成に失敗:', createError);
		return false;
	}
	return true;
}

// ============================================================
// 内部: 多審制時の prompt 所属チェック（一般検定員のみ）
// ============================================================
async function verifyPromptMembership(
	supabase: SupabaseClient,
	opts: {
		sessionId: string;
		modeType: ScoreModeType;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		user: any;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		guestParticipant: any;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		match: (query: any) => any;
	}
): Promise<ScoreMutationOutcome> {
	const sessionDetails = await fetchSessionDetails(supabase, opts.sessionId);
	const isChief = isChiefJudge(opts.user, sessionDetails);
	const isMultiJudge = await getMultiJudgeMode(
		supabase,
		opts.sessionId,
		opts.modeType,
		sessionDetails
	);

	// 既存アクション（input #4.5 / kentei M3）と同じく、主任とゲストは対象外
	if (!isMultiJudge || isChief || opts.guestParticipant) {
		return { accepted: true };
	}

	const { data: prompt, error } = await opts
		.match(supabase.from('scoring_prompts').select('id').eq('session_id', opts.sessionId))
		.limit(1)
		.maybeSingle();

	if (error) {
		logger.error('[scoreSync] scoring_prompts 取得エラー:', error);
		throw new TransientLookupError();
	}

	return prompt ? { accepted: true } : reject('no_matching_prompt');
}

// ============================================================
// 内部: 研修モード保存（input アクションの training 分岐と同一セマンティクス）
// ============================================================
async function applyTrainingScore(
	supabase: SupabaseClient,
	opts: {
		sessionId: string;
		eventId: number;
		bibNumber: number;
		score: number;
		judgeId: string | null;
		guestIdentifier: string | null;
	}
): Promise<ScoreMutationOutcome> {
	// 種目と得点範囲
	const { data: eventData, error: eventError } = await supabase
		.from('training_events')
		.select('min_score, max_score')
		.eq('id', opts.eventId)
		.eq('session_id', opts.sessionId)
		.maybeSingle();
	if (eventError) {
		logger.error('[scoreSync] training_events 取得エラー:', eventError);
		return reject('save_failed');
	}
	if (!eventData) return reject('event_not_found');

	const rangeResult = validateScoreRange(
		opts.score,
		eventData.min_score || 0,
		eventData.max_score || 100
	);
	if (!rangeResult.success) return reject('score_out_of_range');

	// bib → participant 解決（bib/participant 整合チェックを兼ねる）
	const found = await findParticipant(supabase, opts.sessionId, opts.bibNumber);
	if (!found.ok) {
		return found.retryable ? reject('save_failed') : reject('participant_not_found');
	}
	const participantId = found.id;

	// owner ベース upsert（select → update / insert → 23505 は update で吸収）
	let existingQuery = supabase
		.from('training_scores')
		.select('id')
		.eq('event_id', opts.eventId)
		.eq('athlete_id', participantId);
	existingQuery = opts.guestIdentifier
		? existingQuery.eq('guest_identifier', opts.guestIdentifier)
		: existingQuery.eq('judge_id', opts.judgeId);
	const { data: existingScore, error: existingError } = await existingQuery.maybeSingle();
	if (existingError) {
		logger.error('[scoreSync] training_scores 取得エラー:', existingError);
		return reject('save_failed');
	}

	if (existingScore) {
		const { error } = await supabase
			.from('training_scores')
			.update({ score: opts.score, is_finalized: true, updated_at: new Date().toISOString() })
			.eq('id', existingScore.id);
		return error ? reject('save_failed') : { accepted: true };
	}

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const scoreData: any = {
		event_id: opts.eventId,
		athlete_id: participantId,
		score: opts.score,
		is_finalized: true
	};
	if (opts.guestIdentifier) {
		scoreData.guest_identifier = opts.guestIdentifier;
	} else {
		scoreData.judge_id = opts.judgeId;
	}

	const { error: insertErr } = await supabase.from('training_scores').insert(scoreData);
	if (insertErr && insertErr.code === '23505') {
		let dupUpdate = supabase
			.from('training_scores')
			.update({ score: opts.score, is_finalized: true, updated_at: new Date().toISOString() })
			.eq('event_id', opts.eventId)
			.eq('athlete_id', participantId);
		dupUpdate = opts.guestIdentifier
			? dupUpdate.eq('guest_identifier', opts.guestIdentifier)
			: dupUpdate.eq('judge_id', opts.judgeId);
		const { error: dupErr } = await dupUpdate;
		return dupErr ? reject('save_failed') : { accepted: true };
	}
	return insertErr ? reject('save_failed') : { accepted: true };
}

// ============================================================
// 内部: results 保存（kentei/tournament 共通。owner ベース upsert）
// ============================================================
async function applyResultScore(
	supabase: SupabaseClient,
	opts: {
		sessionIdNum: number;
		bibNumber: number;
		score: number;
		maxScore: number;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		user: any;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		guestParticipant: any;
		resolveEvent: () => Promise<{ discipline: string; level: string; event_name: string } | null>;
	}
): Promise<ScoreMutationOutcome> {
	const eventData = await opts.resolveEvent();
	if (!eventData) return reject('event_not_found');

	const rangeResult = validateScoreRange(opts.score, 0, opts.maxScore);
	if (!rangeResult.success) return reject('score_out_of_range');

	const judgeName = await getJudgeName(supabase, opts.user, opts.guestParticipant);
	if (!judgeName) return reject('auth_required');

	const ownerColumn = opts.guestParticipant ? 'guest_identifier' : 'judge_id';
	const ownerValue = opts.guestParticipant ? opts.guestParticipant.guest_identifier : opts.user.id;

	const { data: existingResult, error: existingError } = await supabase
		.from('results')
		.select('id')
		.eq('session_id', opts.sessionIdNum)
		.eq('bib', opts.bibNumber)
		.eq('discipline', eventData.discipline)
		.eq('level', eventData.level)
		.eq('event_name', eventData.event_name)
		.eq(ownerColumn, ownerValue)
		.maybeSingle();
	if (existingError) {
		logger.error('[scoreSync] results 取得エラー:', existingError);
		return reject('save_failed');
	}

	if (existingResult) {
		const { error } = await supabase
			.from('results')
			.update({ score: opts.score, judge_name: judgeName })
			.eq('id', existingResult.id);
		return error ? reject('save_failed') : { accepted: true };
	}

	const resultData: Record<string, unknown> = {
		session_id: opts.sessionIdNum,
		bib: opts.bibNumber,
		score: opts.score,
		judge_name: judgeName,
		discipline: eventData.discipline,
		level: eventData.level,
		event_name: eventData.event_name
	};
	resultData[ownerColumn] = ownerValue;

	const { error: insErr } = await supabase.from('results').insert(resultData);
	if (insErr && insErr.code === '23505') {
		const { data: upd, error: updErr } = await supabase
			.from('results')
			.update({ score: opts.score, judge_name: judgeName })
			.eq('session_id', opts.sessionIdNum)
			.eq('bib', opts.bibNumber)
			.eq('discipline', eventData.discipline)
			.eq('level', eventData.level)
			.eq('event_name', eventData.event_name)
			.eq(ownerColumn, ownerValue)
			.select('id');
		if (updErr) return reject('save_failed');
		if (!upd || upd.length === 0) return reject('name_collision');
		return { accepted: true };
	}
	return insErr ? reject('save_failed') : { accepted: true };
}
