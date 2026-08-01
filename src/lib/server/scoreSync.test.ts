import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * processScoreMutation のユニットテスト
 * 冪等性・拒否分類（恒久=記録あり / 一時=記録なし）・両モードの保存経路を固定する。
 */

vi.mock('$lib/server/sessionAuth', () => ({
	authenticateAction: vi.fn()
}));

vi.mock('$lib/server/sessionHelpers', () => ({
	getJudgeName: vi.fn(async () => '検定 太郎'),
	fetchSessionDetails: vi.fn(async () => ({ chief_judge_id: 'chief-1', is_multi_judge: false })),
	isChiefJudge: vi.fn(() => false),
	getMultiJudgeMode: vi.fn(async () => false)
}));

import { processScoreMutation } from './scoreSync';
import { authenticateAction } from '$lib/server/sessionAuth';
import { getMultiJudgeMode } from '$lib/server/sessionHelpers';

const MUTATION_ID = '123e4567-e89b-12d3-a456-426614174000';

/** チェーン可能なクエリモック */
function makeChain(result: unknown = { data: null, error: null }) {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const c: any = {};
	for (const m of ['select', 'eq', 'is', 'insert', 'update', 'limit', 'order']) {
		c[m] = vi.fn(() => c);
	}
	c.single = vi.fn(async () => result);
	c.maybeSingle = vi.fn(async () => result);
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	c.then = (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject);
	return c;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeSupabase(queues: Record<string, any[]>) {
	return {
		from: vi.fn((table: string) => {
			const q = queues[table];
			if (!q || q.length === 0) throw new Error(`unexpected from(${table})`);
			return q.length > 1 ? q.shift() : q[0];
		})
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
	} as any;
}

const authedUser = { user: { id: 'user-1' }, guestParticipant: null };

const baseMutation = {
	client_mutation_id: MUTATION_ID,
	session_id: 1,
	mode_type: 'training',
	event_id: 10,
	bib_number: 5,
	score: 80
};

const trainingSessionRow = {
	data: { id: 1, mode: 'training', is_tournament_mode: false, chief_judge_id: 'chief-1' },
	error: null
};

beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(authenticateAction).mockResolvedValue(
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		authedUser as any
	);
	vi.mocked(getMultiJudgeMode).mockResolvedValue(false);
});

describe('processScoreMutation - 形式・冪等性', () => {
	it('client_mutation_id が UUID でなければ validation_failed（DB 未接触）', async () => {
		const admin = makeSupabase({});
		const supabase = makeSupabase({});

		const result = await processScoreMutation(supabase, admin, {
			...baseMutation,
			client_mutation_id: 'not-a-uuid'
		});

		expect(result).toEqual({ accepted: false, reason: 'validation_failed' });
		expect(admin.from).not.toHaveBeenCalled();
	});

	it('処理済み（accepted 記録あり）なら再処理せず accepted を返す', async () => {
		const admin = makeSupabase({
			score_mutations: [
				makeChain({ data: { status: 'accepted', rejection_reason: null }, error: null })
			]
		});
		const supabase = makeSupabase({});

		const result = await processScoreMutation(supabase, admin, baseMutation);

		expect(result).toEqual({ accepted: true });
		expect(supabase.from).not.toHaveBeenCalled();
		expect(authenticateAction).not.toHaveBeenCalled();
	});

	it('処理済み（rejected 記録あり）なら記録済みの理由を返す', async () => {
		const admin = makeSupabase({
			score_mutations: [
				makeChain({ data: { status: 'rejected', rejection_reason: 'mode_mismatch' }, error: null })
			]
		});
		const supabase = makeSupabase({});

		const result = await processScoreMutation(supabase, admin, baseMutation);

		expect(result).toEqual({ accepted: false, reason: 'mode_mismatch' });
	});
});

describe('processScoreMutation - 認証（一時的失敗は記録しない）', () => {
	it('authenticateAction 失敗は auth_required を返し、mutation log に記録しない', async () => {
		vi.mocked(authenticateAction).mockResolvedValue(null);
		const logCheck = makeChain({ data: null, error: null });
		const admin = makeSupabase({ score_mutations: [logCheck] });
		const supabase = makeSupabase({});

		const result = await processScoreMutation(supabase, admin, baseMutation);

		expect(result).toEqual({ accepted: false, reason: 'auth_required' });
		// 冪等性チェックの select はあるが、insert（記録）は無い
		expect(logCheck.insert).not.toHaveBeenCalled();
	});
});

describe('processScoreMutation - 研修モード', () => {
	it('正常系: bib→participant 解決、training_scores へ insert、accepted を記録', async () => {
		const logCheck = makeChain({ data: null, error: null });
		const logInsert = makeChain({ error: null });
		const scoreInsert = makeChain({ data: null, error: null });
		const admin = makeSupabase({ score_mutations: [logCheck, logInsert] });
		const supabase = makeSupabase({
			sessions: [makeChain(trainingSessionRow)],
			training_events: [makeChain({ data: { min_score: 0, max_score: 100 }, error: null })],
			participants: [makeChain({ data: { id: 77 }, error: null })],
			training_scores: [
				makeChain({ data: null, error: null }), // 既存スコアなし
				scoreInsert
			]
		});

		const result = await processScoreMutation(supabase, admin, baseMutation);

		expect(result).toEqual({ accepted: true });
		expect(scoreInsert.insert).toHaveBeenCalledWith(
			expect.objectContaining({ event_id: 10, athlete_id: 77, score: 80, judge_id: 'user-1' })
		);
		expect(logInsert.insert).toHaveBeenCalledWith(
			expect.objectContaining({
				client_mutation_id: MUTATION_ID,
				status: 'accepted',
				rejection_reason: null
			})
		);
	});

	it('得点範囲外は score_out_of_range として記録される', async () => {
		const logCheck = makeChain({ data: null, error: null });
		const logInsert = makeChain({ error: null });
		const admin = makeSupabase({ score_mutations: [logCheck, logInsert] });
		const supabase = makeSupabase({
			sessions: [makeChain(trainingSessionRow)],
			training_events: [makeChain({ data: { min_score: 0, max_score: 10 }, error: null })]
		});

		const result = await processScoreMutation(supabase, admin, { ...baseMutation, score: 80 });

		expect(result).toEqual({ accepted: false, reason: 'score_out_of_range' });
		expect(logInsert.insert).toHaveBeenCalledWith(
			expect.objectContaining({ status: 'rejected', rejection_reason: 'score_out_of_range' })
		);
	});

	it('モード不一致（大会セッションに研修 mutation）は mode_mismatch', async () => {
		const logCheck = makeChain({ data: null, error: null });
		const logInsert = makeChain({ error: null });
		const admin = makeSupabase({ score_mutations: [logCheck, logInsert] });
		const supabase = makeSupabase({
			sessions: [
				makeChain({
					data: { id: 1, mode: 'tournament', is_tournament_mode: true, chief_judge_id: null },
					error: null
				})
			]
		});

		const result = await processScoreMutation(supabase, admin, baseMutation);

		expect(result).toEqual({ accepted: false, reason: 'mode_mismatch' });
	});
});

describe('processScoreMutation - 大会モード', () => {
	it('既存の自分の行があれば update される（owner ベース upsert）', async () => {
		const logCheck = makeChain({ data: null, error: null });
		const logInsert = makeChain({ error: null });
		const resultUpdate = makeChain({ data: null, error: null });
		const admin = makeSupabase({ score_mutations: [logCheck, logInsert] });
		const supabase = makeSupabase({
			sessions: [
				makeChain({
					data: { id: 1, mode: 'tournament', is_tournament_mode: true, chief_judge_id: null },
					error: null
				})
			],
			participants: [makeChain({ data: { id: 'p1' }, error: null })],
			custom_events: [
				makeChain({
					data: { discipline: '大会', level: '共通', event_name: '大回り' },
					error: null
				})
			],
			results: [makeChain({ data: { id: 999 }, error: null }), resultUpdate]
		});

		const result = await processScoreMutation(supabase, admin, {
			...baseMutation,
			mode_type: 'tournament'
		});

		expect(result).toEqual({ accepted: true });
		expect(resultUpdate.update).toHaveBeenCalledWith(
			expect.objectContaining({ score: 80, judge_name: '検定 太郎' })
		);
	});

	it('種目が見つからなければ event_not_found として記録される', async () => {
		const logCheck = makeChain({ data: null, error: null });
		const logInsert = makeChain({ error: null });
		const admin = makeSupabase({ score_mutations: [logCheck, logInsert] });
		const supabase = makeSupabase({
			sessions: [
				makeChain({
					data: { id: 1, mode: 'tournament', is_tournament_mode: true, chief_judge_id: null },
					error: null
				})
			],
			participants: [makeChain({ data: { id: 'p1' }, error: null })],
			custom_events: [makeChain({ data: null, error: null })]
		});

		const result = await processScoreMutation(supabase, admin, {
			...baseMutation,
			mode_type: 'tournament'
		});

		expect(result).toEqual({ accepted: false, reason: 'event_not_found' });
		expect(logInsert.insert).toHaveBeenCalledWith(
			expect.objectContaining({ rejection_reason: 'event_not_found' })
		);
	});
});

describe('processScoreMutation - 検定モード（複数検定員の prompt 所属チェック）', () => {
	const certSession = {
		data: { id: 1, mode: 'certification', is_tournament_mode: false, chief_judge_id: 'chief-1' },
		error: null
	};
	const certMutation = {
		...baseMutation,
		mode_type: 'certification',
		event_id: undefined,
		discipline: '基礎',
		level: '1級',
		event_name: '大回り'
	};

	it('複数検定員の一般検定員: セッションの prompt に無い対象は no_matching_prompt', async () => {
		vi.mocked(getMultiJudgeMode).mockResolvedValue(true);
		const logCheck = makeChain({ data: null, error: null });
		const logInsert = makeChain({ error: null });
		const admin = makeSupabase({ score_mutations: [logCheck, logInsert] });
		const supabase = makeSupabase({
			sessions: [makeChain(certSession)],
			scoring_prompts: [makeChain({ data: null, error: null })]
		});

		const result = await processScoreMutation(supabase, admin, certMutation);

		expect(result).toEqual({ accepted: false, reason: 'no_matching_prompt' });
	});

	it('単独検定員: prompt チェック無しで results に保存される', async () => {
		vi.mocked(getMultiJudgeMode).mockResolvedValue(false);
		const logCheck = makeChain({ data: null, error: null });
		const logInsert = makeChain({ error: null });
		const resultInsert = makeChain({ data: null, error: null });
		const admin = makeSupabase({ score_mutations: [logCheck, logInsert] });
		const supabase = makeSupabase({
			sessions: [makeChain(certSession)],
			participants: [makeChain({ data: { id: 'p1' }, error: null })],
			results: [makeChain({ data: null, error: null }), resultInsert]
		});

		const result = await processScoreMutation(supabase, admin, certMutation);

		expect(result).toEqual({ accepted: true });
		expect(resultInsert.insert).toHaveBeenCalledWith(
			expect.objectContaining({
				session_id: 1,
				bib: 5,
				score: 80,
				discipline: '基礎',
				level: '1級',
				event_name: '大回り',
				judge_id: 'user-1'
			})
		);
	});
});

describe('processScoreMutation - レビュー修正の回帰防止', () => {
	const tournamentSession = {
		data: { id: 1, mode: 'tournament', is_tournament_mode: true, chief_judge_id: null },
		error: null
	};
	const certSession = {
		data: { id: 1, mode: 'certification', is_tournament_mode: false, chief_judge_id: 'chief-1' },
		error: null
	};
	const certMutation = {
		...baseMutation,
		mode_type: 'certification',
		event_id: undefined,
		discipline: '基礎',
		level: '1級',
		event_name: '大回り'
	};

	it('保存の一時的失敗（save_failed）は mutation log に記録されない（無限ループ防止）', async () => {
		const logCheck = makeChain({ data: null, error: null });
		const logInsert = makeChain({ error: null });
		const admin = makeSupabase({ score_mutations: [logCheck, logInsert] });
		const supabase = makeSupabase({
			sessions: [makeChain(trainingSessionRow)],
			training_events: [makeChain({ data: { min_score: 0, max_score: 100 }, error: null })],
			participants: [makeChain({ data: { id: 77 }, error: null })],
			training_scores: [
				makeChain({ data: null, error: null }),
				makeChain({ data: null, error: { code: 'XX000', message: 'transient' } })
			]
		});

		const result = await processScoreMutation(supabase, admin, baseMutation);

		expect(result).toEqual({ accepted: false, reason: 'save_failed' });
		expect(logInsert.insert).not.toHaveBeenCalled();
	});

	it('セッション参照の一時的エラーは session_not_found ではなく save_failed（未記録）', async () => {
		const logCheck = makeChain({ data: null, error: null });
		const logInsert = makeChain({ error: null });
		const admin = makeSupabase({ score_mutations: [logCheck, logInsert] });
		const supabase = makeSupabase({
			sessions: [makeChain({ data: null, error: { message: 'network error' } })]
		});

		const result = await processScoreMutation(supabase, admin, baseMutation);

		expect(result).toEqual({ accepted: false, reason: 'save_failed' });
		expect(logInsert.insert).not.toHaveBeenCalled();
	});

	it('session_not_found は返すが FK 制約のため mutation log には記録しない', async () => {
		const logCheck = makeChain({ data: null, error: null });
		const logInsert = makeChain({ error: null });
		const admin = makeSupabase({ score_mutations: [logCheck, logInsert] });
		const supabase = makeSupabase({
			sessions: [makeChain({ data: null, error: null })]
		});

		const result = await processScoreMutation(supabase, admin, baseMutation);

		expect(result).toEqual({ accepted: false, reason: 'session_not_found' });
		expect(logInsert.insert).not.toHaveBeenCalled();
	});

	it('大会 多審制の一般検定員: prompt 外の対象は no_matching_prompt（バイパス封鎖）', async () => {
		vi.mocked(getMultiJudgeMode).mockResolvedValue(true);
		const logCheck = makeChain({ data: null, error: null });
		const logInsert = makeChain({ error: null });
		const promptChain = makeChain({ data: null, error: null });
		const admin = makeSupabase({ score_mutations: [logCheck, logInsert] });
		const supabase = makeSupabase({
			sessions: [makeChain(tournamentSession)],
			scoring_prompts: [promptChain]
		});

		const result = await processScoreMutation(supabase, admin, {
			...baseMutation,
			mode_type: 'tournament'
		});

		expect(result).toEqual({ accepted: false, reason: 'no_matching_prompt' });
		// bib と eventId（level 列）で照合している
		expect(promptChain.eq).toHaveBeenCalledWith('bib_number', 5);
		expect(promptChain.eq).toHaveBeenCalledWith('level', '10');
	});

	it('検定 prompt 照合は event_name も含む4項目（M3 ゲートと同一）', async () => {
		vi.mocked(getMultiJudgeMode).mockResolvedValue(true);
		const logCheck = makeChain({ data: null, error: null });
		const logInsert = makeChain({ error: null });
		const promptChain = makeChain({ data: null, error: null });
		const admin = makeSupabase({ score_mutations: [logCheck, logInsert] });
		const supabase = makeSupabase({
			sessions: [makeChain(certSession)],
			scoring_prompts: [promptChain]
		});

		await processScoreMutation(supabase, admin, certMutation);

		expect(promptChain.eq).toHaveBeenCalledWith('bib_number', 5);
		expect(promptChain.eq).toHaveBeenCalledWith('discipline', '基礎');
		expect(promptChain.eq).toHaveBeenCalledWith('level', '1級');
		expect(promptChain.eq).toHaveBeenCalledWith('event_name', '大回り');
	});

	it('検定: 未登録 bib は参加者を自動作成する（kentei アクションと同一）', async () => {
		const logCheck = makeChain({ data: null, error: null });
		const logInsert = makeChain({ error: null });
		const participantCreate = makeChain({ data: null, error: null });
		const resultInsert = makeChain({ data: null, error: null });
		const admin = makeSupabase({ score_mutations: [logCheck, logInsert] });
		const supabase = makeSupabase({
			sessions: [makeChain(certSession)],
			participants: [makeChain({ data: null, error: null }), participantCreate],
			results: [makeChain({ data: null, error: null }), resultInsert]
		});

		const result = await processScoreMutation(supabase, admin, certMutation);

		expect(result).toEqual({ accepted: true });
		expect(participantCreate.insert).toHaveBeenCalledWith(
			expect.objectContaining({ session_id: '1', bib_number: 5, athlete_name: '選手5' })
		);
	});

	it('検定の得点範囲は 0-99（score=100 は拒否。kentei アクションと同一）', async () => {
		const logCheck = makeChain({ data: null, error: null });
		const logInsert = makeChain({ error: null });
		const admin = makeSupabase({ score_mutations: [logCheck, logInsert] });
		const supabase = makeSupabase({
			sessions: [makeChain(certSession)],
			participants: [makeChain({ data: { id: 'p1' }, error: null })]
		});

		const result = await processScoreMutation(supabase, admin, { ...certMutation, score: 100 });

		expect(result).toEqual({ accepted: false, reason: 'score_out_of_range' });
		expect(logInsert.insert).toHaveBeenCalledWith(
			expect.objectContaining({ rejection_reason: 'score_out_of_range' })
		);
	});

	it('大会: 未登録 bib は participant_not_found（自動作成しない。input アクションと同一）', async () => {
		const logCheck = makeChain({ data: null, error: null });
		const logInsert = makeChain({ error: null });
		const admin = makeSupabase({ score_mutations: [logCheck, logInsert] });
		const supabase = makeSupabase({
			sessions: [makeChain(tournamentSession)],
			participants: [makeChain({ data: null, error: null })]
		});

		const result = await processScoreMutation(supabase, admin, {
			...baseMutation,
			mode_type: 'tournament'
		});

		expect(result).toEqual({ accepted: false, reason: 'participant_not_found' });
	});
});
