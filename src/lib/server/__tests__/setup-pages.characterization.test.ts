import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * tournament-setup / training-setup の participants・events ページの
 * characterization テスト（共通化リファクタリングの前後で挙動が変わらないことを固定する）
 *
 * 2つのモードのページはモードガードとテーブル/カラム名以外は同一の挙動を持つ。
 */

// セッション認証のモック
vi.mock('$lib/server/sessionAuth', () => ({
	authenticateSession: vi.fn(async () => ({ user: { id: 'user-1' }, guestParticipant: null }))
}));

// ---- モック Supabase ビルダー ----

/** チェーン可能なクエリモック。single() / await のどちらでも result を返す */
function makeChain(result: unknown = { data: null, error: null }) {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const c: any = {};
	for (const m of ['select', 'eq', 'neq', 'order', 'limit', 'update', 'delete', 'insert']) {
		c[m] = vi.fn(() => c);
	}
	c.single = vi.fn(async () => result);
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	c.then = (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject);
	return c;
}

/** table ごとのチェーンのキューから from() を返すモック */
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
const makeFormData = (values: Record<string, any>) => ({
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	get: (key: string) => values[key] as any
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const makeEvent = (supabase: any, formValues: Record<string, any> = {}) =>
	({
		params: { id: '1' },
		locals: { supabase },
		request: { formData: async () => makeFormData(formValues) }
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
	}) as any;

// ---- ルートモジュールのインポート（モック設定後） ----

const tournamentParticipants = await import(
	'../../../routes/session/[id]/tournament-setup/participants/+page.server'
);
const trainingParticipants = await import(
	'../../../routes/session/[id]/training-setup/participants/+page.server'
);
const tournamentEvents = await import(
	'../../../routes/session/[id]/tournament-setup/events/+page.server'
);
const trainingEvents = await import(
	'../../../routes/session/[id]/training-setup/events/+page.server'
);

// モードごとの妥当なセッション行
const validSession = {
	tournament: { id: 1, is_tournament_mode: true, created_by: 'user-1', chief_judge_id: null },
	training: { id: 1, mode: 'training', created_by: 'user-1', chief_judge_id: null }
};
// モードガードに引っかかるセッション行
const wrongModeSession = {
	tournament: { id: 1, is_tournament_mode: false, created_by: 'user-1', chief_judge_id: null },
	training: { id: 1, mode: 'certification', created_by: 'user-1', chief_judge_id: null }
};

// ============================================================
// participants ページ（両モード共通の挙動）
// ============================================================

describe.each([
	['tournament', tournamentParticipants],
	['training', trainingParticipants]
] as const)('%s-setup/participants', (mode, module) => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('load', () => {
		it('モードが一致しないセッションでは /dashboard にリダイレクトする', async () => {
			const supabase = makeSupabase({
				sessions: [makeChain({ data: wrongModeSession[mode], error: null })]
			});

			await expect(module.load(makeEvent(supabase))).rejects.toMatchObject({
				status: 303,
				location: '/dashboard'
			});
		});

		it('作成者でも主任でもない場合は /session/[id] にリダイレクトする', async () => {
			const session = { ...validSession[mode], created_by: 'other', chief_judge_id: 'someone' };
			const supabase = makeSupabase({
				sessions: [makeChain({ data: session, error: null })]
			});

			await expect(module.load(makeEvent(supabase))).rejects.toMatchObject({
				status: 303,
				location: '/session/1'
			});
		});

		it('正常時は参加者一覧を bib 昇順で返す', async () => {
			const participants = [
				{ id: 'p1', bib_number: 1, athlete_name: '選手A' },
				{ id: 'p2', bib_number: 2, athlete_name: '選手B' }
			];
			const supabase = makeSupabase({
				sessions: [makeChain({ data: validSession[mode], error: null })],
				participants: [makeChain({ data: participants, error: null })],
				profiles: [makeChain({ data: { full_name: 'テスト' }, error: null })]
			});

			const result = await module.load(makeEvent(supabase));
			expect(result).toMatchObject({ participants });
		});
	});

	describe('addParticipant', () => {
		it('ゼッケン番号が不正なら 400 を返す', async () => {
			const supabase = makeSupabase({});
			const result = await module.actions.addParticipant(
				makeEvent(supabase, { bibNumber: 'abc', athleteName: '選手A' })
			);
			expect(result).toMatchObject({ status: 400 });
		});

		it('重複ゼッケンなら 400 を返す', async () => {
			const supabase = makeSupabase({
				participants: [makeChain({ data: { id: 'existing' }, error: null })]
			});
			const result = await module.actions.addParticipant(
				makeEvent(supabase, { bibNumber: '1', athleteName: '選手A' })
			);
			expect(result).toMatchObject({ status: 400 });
		});

		it('正常時は participants に insert して成功を返す', async () => {
			const dupCheck = makeChain({ data: null, error: null });
			const insert = makeChain({ error: null });
			const supabase = makeSupabase({ participants: [dupCheck, insert] });

			const result = await module.actions.addParticipant(
				makeEvent(supabase, { bibNumber: '5', athleteName: ' 選手A ', teamName: 'チームX' })
			);

			expect(insert.insert).toHaveBeenCalledWith({
				session_id: '1',
				bib_number: 5,
				athlete_name: '選手A',
				team_name: 'チームX'
			});
			expect(result).toMatchObject({ success: true });
		});
	});

	describe('importCSV', () => {
		const csvFile = (text: string) => ({ size: text.length, text: async () => text });

		it('ヘッダー行をスキップして全行を洗い替えでインポートする', async () => {
			const del = makeChain({ error: null });
			const insert = makeChain({ error: null });
			const supabase = makeSupabase({ participants: [del, insert] });

			const result = await module.actions.importCSV(
				makeEvent(supabase, {
					csvFile: csvFile('ゼッケン,選手名,チーム\n1,選手A,チームX\n2,選手B,')
				})
			);

			expect(del.delete).toHaveBeenCalled();
			expect(insert.insert).toHaveBeenCalledWith([
				{ session_id: '1', bib_number: 1, athlete_name: '選手A', team_name: 'チームX' },
				{ session_id: '1', bib_number: 2, athlete_name: '選手B', team_name: null }
			]);
			expect(result).toMatchObject({ success: true });
		});

		it('形式不正の行があれば 400 を返す', async () => {
			const supabase = makeSupabase({});
			const result = await module.actions.importCSV(
				makeEvent(supabase, { csvFile: csvFile('1,選手A\nばつ') })
			);
			expect(result).toMatchObject({ status: 400 });
		});
	});

	describe('認証', () => {
		it('未認証ユーザーのアクションは 401 を返す', async () => {
			const supabase = makeSupabase({});
			supabase.auth.getUser = vi.fn(async () => ({
				data: { user: null },
				error: { message: 'no' }
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
			})) as any;

			const result = await module.actions.deleteParticipant(
				makeEvent(supabase, { participantId: 'p1' })
			);
			expect(result).toMatchObject({ status: 401 });
		});
	});
});

// ============================================================
// events ページ（テーブル/カラム/insert ペイロードがモードで異なる）
// ============================================================

const eventsTableConfig = {
	tournament: { table: 'custom_events', nameColumn: 'event_name', orderColumn: 'display_order' },
	training: { table: 'training_events', nameColumn: 'name', orderColumn: 'order_index' }
} as const;

describe.each([
	['tournament', tournamentEvents],
	['training', trainingEvents]
] as const)('%s-setup/events', (mode, module) => {
	const cfg = eventsTableConfig[mode];

	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('load', () => {
		it('モードが一致しないセッションでは /dashboard にリダイレクトする', async () => {
			const supabase = makeSupabase({
				sessions: [makeChain({ data: wrongModeSession[mode], error: null })]
			});

			await expect(module.load(makeEvent(supabase))).rejects.toMatchObject({
				status: 303,
				location: '/dashboard'
			});
		});

		it('正常時は種目一覧を返す（モード対応テーブルから取得）', async () => {
			const events = [{ id: 'e1' }, { id: 'e2' }];
			const supabase = makeSupabase({
				sessions: [makeChain({ data: validSession[mode], error: null })],
				[cfg.table]: [makeChain({ data: events, error: null })],
				profiles: [makeChain({ data: null, error: null })]
			});

			const result = await module.load(makeEvent(supabase));
			expect(result).toMatchObject({ events });
			expect(supabase.from).toHaveBeenCalledWith(cfg.table);
		});
	});

	describe('addEvent', () => {
		it('種目名が空なら 400 を返す', async () => {
			const supabase = makeSupabase({});
			const result = await module.actions.addEvent(makeEvent(supabase, { eventName: '' }));
			expect(result).toMatchObject({ status: 400 });
		});

		it('正常時はモード固有のペイロードで insert する', async () => {
			const maxOrder = makeChain({ data: { [cfg.orderColumn]: 2 }, error: null });
			const insert = makeChain({ error: null });
			const supabase = makeSupabase({ [cfg.table]: [maxOrder, insert] });

			const result = await module.actions.addEvent(makeEvent(supabase, { eventName: ' 大回り ' }));

			if (mode === 'tournament') {
				expect(insert.insert).toHaveBeenCalledWith({
					session_id: '1',
					discipline: '大会',
					level: '共通',
					event_name: '大回り',
					display_order: 3
				});
			} else {
				expect(insert.insert).toHaveBeenCalledWith({
					session_id: '1',
					name: '大回り',
					order_index: 3,
					min_score: 0,
					max_score: 100,
					score_precision: 1,
					status: 'pending'
				});
			}
			expect(result).toMatchObject({ success: true });
		});
	});

	describe('updateEvent', () => {
		it('モード対応のカラム名で更新する', async () => {
			const update = makeChain({ error: null });
			const supabase = makeSupabase({ [cfg.table]: [update] });

			const result = await module.actions.updateEvent(
				makeEvent(supabase, { eventId: 'e1', eventName: ' 小回り ' })
			);

			expect(update.update).toHaveBeenCalledWith({ [cfg.nameColumn]: '小回り' });
			expect(result).toMatchObject({ success: true });
		});
	});

	describe('deleteEvent', () => {
		it('種目IDが無ければ 400、あれば削除して成功を返す', async () => {
			const supabase = makeSupabase({ [cfg.table]: [makeChain({ error: null })] });

			const missing = await module.actions.deleteEvent(makeEvent(supabase, {}));
			expect(missing).toMatchObject({ status: 400 });

			const result = await module.actions.deleteEvent(makeEvent(supabase, { eventId: 'e1' }));
			expect(result).toMatchObject({ success: true });
		});
	});
});
