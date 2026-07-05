import { describe, it, expect, vi, beforeEach } from 'vitest';
import { actions } from './+page.server';

/**
 * details ページの未テストだった12アクションの characterization テスト
 * （アクション分割リファクタリングの前後で挙動が変わらないことを固定する）
 *
 * purge 系3アクション（deleteTrainingData/Certification/Tournament）は
 * page.server.deleteData.test.ts が既にカバーしている。
 */

/** チェーン可能なクエリモック。single()/maybeSingle()/await のどれでも result を返す */
function makeChain(result: unknown = { data: null, error: null }) {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const c: any = {};
	for (const m of [
		'select',
		'eq',
		'neq',
		'is',
		'in',
		'order',
		'limit',
		'update',
		'delete',
		'insert'
	]) {
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
		auth: {
			getUser: vi.fn(async () => ({ data: { user: { id: 'user-1' } }, error: null }))
		},
		from: vi.fn((table: string) => {
			const q = queues[table];
			if (!q || q.length === 0) throw new Error(`unexpected from(${table})`);
			return q.length > 1 ? q.shift() : q[0];
		})
	};
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const makeEvent = (supabase: any, formValues: Record<string, any> = {}) =>
	({
		params: { id: '1' },
		locals: { supabase },
		request: {
			formData: async () => ({
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				get: (key: string) => formValues[key] as any
			})
		}
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
	}) as any;

beforeEach(() => {
	vi.clearAllMocks();
});

describe('appointChief', () => {
	it('ゲストを主任に任命しようとすると 400', async () => {
		const supabase = makeSupabase({
			session_participants: [makeChain({ data: { is_guest: true }, error: null })]
		});
		const result = await actions.appointChief(makeEvent(supabase, { userId: 'guest-1' }));
		expect(result).toMatchObject({ status: 400 });
	});

	it('別ユーザーを任命すると chief_judge_id にセットされる', async () => {
		const update = makeChain({ error: null });
		const supabase = makeSupabase({
			session_participants: [makeChain({ data: { is_guest: false }, error: null })],
			sessions: [makeChain({ data: { chief_judge_id: 'other' }, error: null }), update]
		});

		const result = await actions.appointChief(makeEvent(supabase, { userId: 'user-2' }));

		expect(update.update).toHaveBeenCalledWith({ chief_judge_id: 'user-2' });
		expect(result).toEqual({ success: true });
	});

	it('現在の主任を再任命すると解任（null）になるトグル仕様', async () => {
		const update = makeChain({ error: null });
		const supabase = makeSupabase({
			session_participants: [makeChain({ data: { is_guest: false }, error: null })],
			sessions: [makeChain({ data: { chief_judge_id: 'user-2' }, error: null }), update]
		});

		await actions.appointChief(makeEvent(supabase, { userId: 'user-2' }));

		expect(update.update).toHaveBeenCalledWith({ chief_judge_id: null });
	});
});

describe('removeGuest', () => {
	it('guestIdentifier が無ければ 400', async () => {
		const supabase = makeSupabase({});
		const result = await actions.removeGuest(makeEvent(supabase, {}));
		expect(result).toMatchObject({ status: 400 });
	});

	it('作成者以外は 403', async () => {
		const supabase = makeSupabase({
			sessions: [makeChain({ data: { created_by: 'someone-else' }, error: null })]
		});
		const result = await actions.removeGuest(makeEvent(supabase, { guestIdentifier: 'g-1' }));
		expect(result).toMatchObject({ status: 403 });
	});

	it('作成者はゲストを削除できる（is_guest=true 条件つき delete）', async () => {
		const del = makeChain({ error: null });
		const supabase = makeSupabase({
			sessions: [makeChain({ data: { created_by: 'user-1' }, error: null })],
			session_participants: [del]
		});

		const result = await actions.removeGuest(makeEvent(supabase, { guestIdentifier: 'g-1' }));

		expect(del.delete).toHaveBeenCalled();
		expect(del.eq).toHaveBeenCalledWith('guest_identifier', 'g-1');
		expect(del.eq).toHaveBeenCalledWith('is_guest', true);
		expect(result).toMatchObject({ success: true });
	});
});

describe('removeParticipant', () => {
	const sessionRow = { data: { created_by: 'user-1', chief_judge_id: 'chief-1' }, error: null };

	it('作成者以外は 403', async () => {
		const supabase = makeSupabase({
			sessions: [makeChain({ data: { created_by: 'other', chief_judge_id: null }, error: null })]
		});
		const result = await actions.removeParticipant(makeEvent(supabase, { userId: 'user-2' }));
		expect(result).toMatchObject({ status: 403 });
	});

	it('自分自身は削除できない（400）', async () => {
		const supabase = makeSupabase({ sessions: [makeChain(sessionRow)] });
		const result = await actions.removeParticipant(makeEvent(supabase, { userId: 'user-1' }));
		expect(result).toMatchObject({ status: 400 });
	});

	it('主任検定員は削除できない（400）', async () => {
		const supabase = makeSupabase({ sessions: [makeChain(sessionRow)] });
		const result = await actions.removeParticipant(makeEvent(supabase, { userId: 'chief-1' }));
		expect(result).toMatchObject({ status: 400 });
	});

	it('作成者は一般検定員を削除できる', async () => {
		const del = makeChain({ error: null });
		const supabase = makeSupabase({
			sessions: [makeChain(sessionRow)],
			session_participants: [del]
		});

		const result = await actions.removeParticipant(makeEvent(supabase, { userId: 'user-2' }));

		expect(del.eq).toHaveBeenCalledWith('user_id', 'user-2');
		expect(del.eq).toHaveBeenCalledWith('is_guest', false);
		expect(result).toMatchObject({ success: true });
	});
});

describe('updateTrainingSettings', () => {
	it('training_sessions が無ければ既定値つきで新規作成する', async () => {
		const insert = makeChain({ data: [{}], error: null });
		const supabase = makeSupabase({
			training_sessions: [makeChain({ data: null, error: null }), insert]
		});

		const result = await actions.updateTrainingSettings(
			makeEvent(supabase, { isMultiJudge: 'true' })
		);

		expect(insert.insert).toHaveBeenCalledWith({
			session_id: '1',
			max_judges: 100,
			show_individual_scores: true,
			show_score_comparison: true,
			show_deviation_analysis: false,
			is_multi_judge: true
		});
		expect(result).toHaveProperty('trainingSettingsSuccess');
	});

	it('既存レコードがあれば is_multi_judge のみ更新する', async () => {
		const update = makeChain({ data: [{}], error: null });
		const supabase = makeSupabase({
			training_sessions: [makeChain({ data: { session_id: '1' }, error: null }), update]
		});

		const result = await actions.updateTrainingSettings(
			makeEvent(supabase, { isMultiJudge: 'false' })
		);

		expect(update.update).toHaveBeenCalledWith({ is_multi_judge: false });
		expect(result).toHaveProperty('trainingSettingsSuccess');
	});
});

describe('updateTournamentSettings', () => {
	it('点差上限が範囲外（1〜10以外）なら 400', async () => {
		const supabase = makeSupabase({});
		const result = await actions.updateTournamentSettings(
			makeEvent(supabase, {
				scoringMethod: '5judges',
				enableScoreDiffControl: 'on',
				maxScoreDiff: '11'
			})
		);
		expect(result).toMatchObject({ status: 400 });
	});

	it('5judges なら exclude_extremes=true、コントロール無効なら max_score_diff=null', async () => {
		const update = makeChain({ error: null });
		const supabase = makeSupabase({ sessions: [update] });

		const result = await actions.updateTournamentSettings(
			makeEvent(supabase, { scoringMethod: '5judges' })
		);

		expect(update.update).toHaveBeenCalledWith({
			exclude_extremes: true,
			max_score_diff: null
		});
		expect(result).toHaveProperty('tournamentSettingsSuccess');
	});
});

describe('updateSettings', () => {
	it('複数検定員モードで requiredJudges が不正なら 400', async () => {
		const supabase = makeSupabase({});
		const result = await actions.updateSettings(
			makeEvent(supabase, { isMultiJudge: 'true', requiredJudges: '0' })
		);
		expect(result).toMatchObject({ status: 400 });
	});

	it('requiredJudges が参加者数を超えたら 400', async () => {
		const countChain = makeChain({ count: 2, error: null });
		const supabase = makeSupabase({ session_participants: [countChain] });

		const result = await actions.updateSettings(
			makeEvent(supabase, { isMultiJudge: 'true', requiredJudges: '5' })
		);
		expect(result).toMatchObject({ status: 400 });
	});

	it('複数検定員OFFなら required_judges は null で更新する', async () => {
		const update = makeChain({ error: null });
		const supabase = makeSupabase({ sessions: [update] });

		const result = await actions.updateSettings(
			makeEvent(supabase, { isMultiJudge: 'false', requiredJudges: '3' })
		);

		expect(update.update).toHaveBeenCalledWith({
			is_multi_judge: false,
			required_judges: null
		});
		expect(result).toHaveProperty('settingsSuccess');
	});
});

describe('addEvent', () => {
	it('種目名が空なら 400', async () => {
		const supabase = makeSupabase({});
		const result = await actions.addEvent(makeEvent(supabase, { eventName: '  ' }));
		expect(result).toMatchObject({ status: 400 });
	});

	it('大会モードは custom_events に固定 discipline/level で insert する', async () => {
		const maxOrder = makeChain({ data: { display_order: 2 }, error: null });
		const insert = makeChain({ error: null });
		const supabase = makeSupabase({
			sessions: [makeChain({ data: { mode: null, is_tournament_mode: true }, error: null })],
			custom_events: [maxOrder, insert]
		});

		const result = await actions.addEvent(makeEvent(supabase, { eventName: ' 大回り ' }));

		expect(insert.insert).toHaveBeenCalledWith({
			session_id: '1',
			discipline: '大会',
			level: '共通',
			event_name: '大回り',
			display_order: 3
		});
		expect(result).toHaveProperty('eventSuccess');
	});

	it('研修モードは training_events に既定スコア設定つきで insert する', async () => {
		const maxOrder = makeChain({ data: null, error: null });
		const insert = makeChain({ error: null });
		const supabase = makeSupabase({
			sessions: [makeChain({ data: { mode: 'training', is_tournament_mode: false }, error: null })],
			training_events: [maxOrder, insert]
		});

		await actions.addEvent(makeEvent(supabase, { eventName: '基礎' }));

		expect(insert.insert).toHaveBeenCalledWith({
			session_id: '1',
			name: '基礎',
			order_index: 1,
			min_score: 0,
			max_score: 100,
			score_precision: 1,
			status: 'pending'
		});
	});
});

describe('updateEvent / deleteEvent', () => {
	it('updateEvent: isTraining フラグで対象テーブルとカラムが切り替わる', async () => {
		const update = makeChain({ error: null });
		const supabase = makeSupabase({ training_events: [update] });

		await actions.updateEvent(
			makeEvent(supabase, { eventId: 'e1', eventName: '新名称', isTraining: 'true' })
		);
		expect(update.update).toHaveBeenCalledWith({ name: '新名称' });

		const update2 = makeChain({ error: null });
		const supabase2 = makeSupabase({ custom_events: [update2] });
		await actions.updateEvent(
			makeEvent(supabase2, { eventId: 'e1', eventName: '新名称', isTraining: 'false' })
		);
		expect(update2.update).toHaveBeenCalledWith({ event_name: '新名称' });
	});

	it('deleteEvent: eventId が無ければ 400、あればモード対応テーブルから削除', async () => {
		const supabase = makeSupabase({});
		const missing = await actions.deleteEvent(makeEvent(supabase, { isTraining: 'false' }));
		expect(missing).toMatchObject({ status: 400 });

		const del = makeChain({ error: null });
		const supabase2 = makeSupabase({ custom_events: [del] });
		const result = await actions.deleteEvent(
			makeEvent(supabase2, { eventId: 'e1', isTraining: 'false' })
		);
		expect(del.delete).toHaveBeenCalled();
		expect(result).toHaveProperty('eventSuccess');
	});
});

describe('updateName', () => {
	it('作成者以外は 403', async () => {
		const supabase = makeSupabase({
			sessions: [makeChain({ data: { created_by: 'other' }, error: null })]
		});
		const result = await actions.updateName(makeEvent(supabase, { name: '新セッション名' }));
		expect(result).toMatchObject({ status: 403 });
	});

	it('不正なセッション名は 400', async () => {
		const supabase = makeSupabase({
			sessions: [makeChain({ data: { created_by: 'user-1' }, error: null })]
		});
		const result = await actions.updateName(makeEvent(supabase, { name: '' }));
		expect(result).toMatchObject({ status: 400 });
	});

	it('作成者はサニタイズ済みの名前で更新できる', async () => {
		const update = makeChain({ error: null });
		const supabase = makeSupabase({
			sessions: [makeChain({ data: { created_by: 'user-1' }, error: null }), update]
		});

		const result = await actions.updateName(makeEvent(supabase, { name: '新セッション名' }));

		expect(update.update).toHaveBeenCalledWith({ name: '新セッション名' });
		expect(result).toMatchObject({ success: true });
	});
});

describe('deleteSession', () => {
	it('作成者以外は 403', async () => {
		const supabase = makeSupabase({
			sessions: [makeChain({ data: { created_by: 'other' }, error: null })]
		});
		const result = await actions.deleteSession(makeEvent(supabase));
		expect(result).toMatchObject({ status: 403 });
	});

	it('作成者は関連データごと削除し /dashboard へリダイレクトする', async () => {
		const sessionsSelect = makeChain({ data: { created_by: 'user-1' }, error: null });
		const sessionsDelete = makeChain({ error: null });
		const results = makeChain({ error: null });
		const participants = makeChain({ error: null });
		const prompts = makeChain({ error: null });
		const supabase = makeSupabase({
			sessions: [sessionsSelect, sessionsDelete],
			results: [results],
			session_participants: [participants],
			scoring_prompts: [prompts]
		});

		await expect(actions.deleteSession(makeEvent(supabase))).rejects.toMatchObject({
			status: 303,
			location: '/dashboard'
		});

		expect(results.delete).toHaveBeenCalled();
		expect(participants.delete).toHaveBeenCalled();
		expect(prompts.delete).toHaveBeenCalled();
		expect(sessionsDelete.delete).toHaveBeenCalled();
	});
});

describe('未認証時の挙動', () => {
	 
	const unauthSupabase = () => {
		const supabase = makeSupabase({});
		supabase.auth.getUser = vi.fn(async () => ({
			data: { user: null },
			error: { message: 'no' }
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
		})) as any;
		return supabase;
	};

	it('appointChief は /login へリダイレクト', async () => {
		await expect(actions.appointChief(makeEvent(unauthSupabase()))).rejects.toMatchObject({
			status: 303,
			location: '/login'
		});
	});

	it('addEvent は 401 を返す', async () => {
		const result = await actions.addEvent(makeEvent(unauthSupabase(), { eventName: 'x' }));
		expect(result).toMatchObject({ status: 401 });
	});
});
