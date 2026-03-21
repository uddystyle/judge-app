/**
 * deleteTrainingData / deleteCertificationData アクションのテスト
 *
 * 認証・権限・モード検証・DB操作・active_prompt_id リセットをカバーする。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- モジュールモック ---

vi.mock('@sveltejs/kit', async () => {
	const actual = await vi.importActual('@sveltejs/kit');
	return {
		...actual,
		error: vi.fn((status: number, data: any) => {
			const err = new Error(`Error ${status}`);
			(err as any).status = status;
			(err as any).body = data;
			throw err;
		}),
		fail: vi.fn((status: number, data: any) => ({ status, data })),
		redirect: vi.fn((status: number, location: string) => {
			const err = new Error(`Redirecting to ${location}`);
			(err as any).status = status;
			(err as any).location = location;
			throw err;
		})
	};
});

vi.mock('@supabase/supabase-js', () => ({
	createClient: vi.fn()
}));

vi.mock('$env/static/public', () => ({
	PUBLIC_SUPABASE_URL: 'https://test.supabase.co'
}));

vi.mock('$env/static/private', () => ({
	SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key'
}));

vi.mock('$lib/server/validation', () => ({
	validateSessionName: vi.fn()
}));

import { actions } from './+page.server';
import { fail, redirect } from '@sveltejs/kit';
import { createClient } from '@supabase/supabase-js';

// --- ヘルパー ---

/** sessions.update() チェーンのモックを生成 */
function createUpdateChain() {
	const mockUpdateEq = vi.fn().mockResolvedValue({ error: null });
	const mockUpdate = vi.fn().mockReturnValue({ eq: mockUpdateEq });
	return { chain: { update: mockUpdate }, mockUpdate, mockUpdateEq };
}

function createMockSupabase(overrides?: {
	getUser?: any;
	sessionSelect?: any;
	trainingEventsSelect?: any;
	sessionUpdateError?: any;
}) {
	const getUserResult = overrides?.getUser ?? {
		data: { user: { id: 'user-creator' } },
		error: null
	};

	const sessionResult = overrides?.sessionSelect ?? {
		data: { created_by: 'user-creator', mode: 'training' },
		error: null
	};

	const trainingEventsResult = overrides?.trainingEventsSelect ?? {
		data: [{ id: 'event-1' }, { id: 'event-2' }],
		error: null
	};

	const fromMock = vi.fn();

	// 1回目: sessions.select (権限チェック)
	const sessionsChain = {
		select: vi.fn().mockReturnValue({
			eq: vi.fn().mockReturnValue({
				single: vi.fn().mockResolvedValue(sessionResult)
			})
		})
	};

	// 2回目: training_events.select
	const trainingEventsChain = {
		select: vi.fn().mockReturnValue({
			eq: vi.fn().mockResolvedValue(trainingEventsResult)
		})
	};

	// 3回目: sessions.update (active_prompt_id クリア)
	const updateEq = vi.fn().mockResolvedValue({
		error: overrides?.sessionUpdateError ?? null
	});
	const updateMock = vi.fn().mockReturnValue({ eq: updateEq });
	const sessionsUpdateChain = { update: updateMock };

	fromMock
		.mockReturnValueOnce(sessionsChain)
		.mockReturnValueOnce(trainingEventsChain)
		.mockReturnValueOnce(sessionsUpdateChain);

	return {
		auth: {
			getUser: vi.fn().mockResolvedValue(getUserResult)
		},
		from: fromMock,
		_updateMock: updateMock,
		_updateEq: updateEq
	};
}

function createCertMockSupabase(overrides?: {
	getUser?: any;
	sessionSelect?: any;
	sessionUpdateError?: any;
}) {
	const getUserResult = overrides?.getUser ?? {
		data: { user: { id: 'user-creator' } },
		error: null
	};

	const sessionResult = overrides?.sessionSelect ?? {
		data: { created_by: 'user-creator', mode: 'certification' },
		error: null
	};

	const fromMock = vi.fn();

	// 1回目: sessions.select (権限チェック)
	fromMock.mockReturnValueOnce({
		select: vi.fn().mockReturnValue({
			eq: vi.fn().mockReturnValue({
				single: vi.fn().mockResolvedValue(sessionResult)
			})
		})
	});

	// 2回目: sessions.update (active_prompt_id クリア)
	const updateEq = vi.fn().mockResolvedValue({
		error: overrides?.sessionUpdateError ?? null
	});
	const updateMock = vi.fn().mockReturnValue({ eq: updateEq });
	fromMock.mockReturnValueOnce({ update: updateMock });

	return {
		auth: {
			getUser: vi.fn().mockResolvedValue(getUserResult)
		},
		from: fromMock,
		_updateMock: updateMock,
		_updateEq: updateEq
	};
}

function createActionArgs(params: Record<string, string>, supabase: any) {
	return {
		params,
		locals: { supabase },
		request: { formData: vi.fn() },
		url: new URL('http://localhost')
	} as any;
}

// --- テスト ---

describe('deleteTrainingData アクション', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('未認証ユーザーは /login にリダイレクトされる', async () => {
		const mockSupabase = createMockSupabase({
			getUser: { data: { user: null }, error: { message: 'not authenticated' } }
		});

		await expect(
			actions.deleteTrainingData(createActionArgs({ id: 'session-1' }, mockSupabase))
		).rejects.toThrow('Redirecting to /login');

		expect(redirect).toHaveBeenCalledWith(303, '/login');
	});

	it('セッションが見つからない場合は 404 を返す', async () => {
		const mockSupabase = createMockSupabase({
			sessionSelect: { data: null, error: { message: 'not found' } }
		});

		const result = await actions.deleteTrainingData(
			createActionArgs({ id: 'session-1' }, mockSupabase)
		);

		expect(fail).toHaveBeenCalledWith(404, { error: 'セッションが見つかりません。' });
	});

	it('作成者以外は 403 を返す', async () => {
		const mockSupabase = createMockSupabase({
			sessionSelect: {
				data: { created_by: 'other-user', mode: 'training' },
				error: null
			}
		});

		const result = await actions.deleteTrainingData(
			createActionArgs({ id: 'session-1' }, mockSupabase)
		);

		expect(fail).toHaveBeenCalledWith(403, { error: 'データを削除する権限がありません。' });
	});

	it('研修モード以外は 400 を返す', async () => {
		const mockSupabase = createMockSupabase({
			sessionSelect: {
				data: { created_by: 'user-creator', mode: 'certification' },
				error: null
			}
		});

		const result = await actions.deleteTrainingData(
			createActionArgs({ id: 'session-1' }, mockSupabase)
		);

		expect(fail).toHaveBeenCalledWith(400, {
			error: '研修モードのセッションのみデータ削除が可能です。'
		});
	});

	it('正常系: training_scores を削除し active_prompt_id をクリアして成功を返す', async () => {
		const mockSupabase = createMockSupabase();

		// Service Role クライアントのモック
		const mockAdminDelete = vi.fn().mockReturnValue({
			in: vi.fn().mockResolvedValue({ error: null, count: 5 })
		});
		const mockAdminFrom = vi.fn().mockReturnValue({
			delete: mockAdminDelete
		});
		vi.mocked(createClient).mockReturnValue({ from: mockAdminFrom } as any);

		const result = await actions.deleteTrainingData(
			createActionArgs({ id: 'session-1' }, mockSupabase)
		);

		// Service Role クライアントが正しく作成されたか
		expect(createClient).toHaveBeenCalledWith(
			'https://test.supabase.co',
			'test-service-role-key',
			expect.objectContaining({
				auth: { autoRefreshToken: false, persistSession: false }
			})
		);

		// training_scores テーブルから削除
		expect(mockAdminFrom).toHaveBeenCalledWith('training_scores');
		expect(mockAdminDelete).toHaveBeenCalledWith({ count: 'exact' });

		// active_prompt_id がクリアされたか
		expect(mockSupabase._updateMock).toHaveBeenCalledWith({ active_prompt_id: null });
		expect(mockSupabase._updateEq).toHaveBeenCalledWith('id', 'session-1');

		expect(result).toEqual({
			success: true,
			message: '研修モードの採点データを削除しました。'
		});
	});

	it('training_events が空の場合も active_prompt_id をクリアして成功を返す', async () => {
		const mockSupabase = createMockSupabase({
			trainingEventsSelect: { data: [], error: null }
		});

		const result = await actions.deleteTrainingData(
			createActionArgs({ id: 'session-1' }, mockSupabase)
		);

		// Service Role クライアントは作成されない
		expect(createClient).not.toHaveBeenCalled();

		// active_prompt_id はクリアされる
		expect(mockSupabase._updateMock).toHaveBeenCalledWith({ active_prompt_id: null });

		expect(result).toEqual({
			success: true,
			message: '研修モードの採点データを削除しました。'
		});
	});

	it('削除失敗時は 500 を返す', async () => {
		const mockSupabase = createMockSupabase();

		const mockAdminDelete = vi.fn().mockReturnValue({
			in: vi.fn().mockResolvedValue({
				error: { message: 'delete failed' },
				count: null
			})
		});
		vi.mocked(createClient).mockReturnValue({
			from: vi.fn().mockReturnValue({ delete: mockAdminDelete })
		} as any);

		const result = await actions.deleteTrainingData(
			createActionArgs({ id: 'session-1' }, mockSupabase)
		);

		expect(fail).toHaveBeenCalledWith(500, {
			error: '採点データの削除に失敗しました。delete failed'
		});
	});
});

describe('deleteCertificationData アクション', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('未認証ユーザーは /login にリダイレクトされる', async () => {
		const mockSupabase = createCertMockSupabase({
			getUser: { data: { user: null }, error: { message: 'not authenticated' } }
		});

		await expect(
			actions.deleteCertificationData(createActionArgs({ id: 'session-1' }, mockSupabase))
		).rejects.toThrow('Redirecting to /login');

		expect(redirect).toHaveBeenCalledWith(303, '/login');
	});

	it('セッションが見つからない場合は 404 を返す', async () => {
		const mockSupabase = createCertMockSupabase({
			sessionSelect: { data: null, error: { message: 'not found' } }
		});

		const result = await actions.deleteCertificationData(
			createActionArgs({ id: 'session-1' }, mockSupabase)
		);

		expect(fail).toHaveBeenCalledWith(404, { error: 'セッションが見つかりません。' });
	});

	it('作成者以外は 403 を返す', async () => {
		const mockSupabase = createCertMockSupabase({
			sessionSelect: {
				data: { created_by: 'other-user', mode: 'certification' },
				error: null
			}
		});

		const result = await actions.deleteCertificationData(
			createActionArgs({ id: 'session-1' }, mockSupabase)
		);

		expect(fail).toHaveBeenCalledWith(403, { error: 'データを削除する権限がありません。' });
	});

	it('検定モード以外は 400 を返す', async () => {
		const mockSupabase = createCertMockSupabase({
			sessionSelect: {
				data: { created_by: 'user-creator', mode: 'training' },
				error: null
			}
		});

		const result = await actions.deleteCertificationData(
			createActionArgs({ id: 'session-1' }, mockSupabase)
		);

		expect(fail).toHaveBeenCalledWith(400, {
			error: '検定モードのセッションのみデータ削除が可能です。'
		});
	});

	it('大会モードでも 400 を返す', async () => {
		const mockSupabase = createCertMockSupabase({
			sessionSelect: {
				data: { created_by: 'user-creator', mode: 'tournament' },
				error: null
			}
		});

		const result = await actions.deleteCertificationData(
			createActionArgs({ id: 'session-1' }, mockSupabase)
		);

		expect(fail).toHaveBeenCalledWith(400, {
			error: '検定モードのセッションのみデータ削除が可能です。'
		});
	});

	it('正常系: results テーブルから削除し active_prompt_id をクリアして成功を返す', async () => {
		const mockSupabase = createCertMockSupabase();

		// Service Role クライアントのモック
		const mockAdminEq = vi.fn().mockResolvedValue({ error: null, count: 10 });
		const mockAdminDelete = vi.fn().mockReturnValue({ eq: mockAdminEq });
		const mockAdminFrom = vi.fn().mockReturnValue({ delete: mockAdminDelete });
		vi.mocked(createClient).mockReturnValue({ from: mockAdminFrom } as any);

		const result = await actions.deleteCertificationData(
			createActionArgs({ id: 'session-1' }, mockSupabase)
		);

		// Service Role クライアントが正しく作成されたか
		expect(createClient).toHaveBeenCalledWith(
			'https://test.supabase.co',
			'test-service-role-key',
			expect.objectContaining({
				auth: { autoRefreshToken: false, persistSession: false }
			})
		);

		// results テーブルから session_id で削除
		expect(mockAdminFrom).toHaveBeenCalledWith('results');
		expect(mockAdminDelete).toHaveBeenCalledWith({ count: 'exact' });
		expect(mockAdminEq).toHaveBeenCalledWith('session_id', 'session-1');

		// active_prompt_id がクリアされたか
		expect(mockSupabase._updateMock).toHaveBeenCalledWith({ active_prompt_id: null });
		expect(mockSupabase._updateEq).toHaveBeenCalledWith('id', 'session-1');

		expect(result).toEqual({
			success: true,
			message: '検定モードの採点データを削除しました。'
		});
	});

	it('削除失敗時は 500 を返す', async () => {
		const mockSupabase = createCertMockSupabase();

		const mockAdminEq = vi.fn().mockResolvedValue({
			error: { message: 'delete failed' },
			count: null
		});
		vi.mocked(createClient).mockReturnValue({
			from: vi.fn().mockReturnValue({
				delete: vi.fn().mockReturnValue({ eq: mockAdminEq })
			})
		} as any);

		const result = await actions.deleteCertificationData(
			createActionArgs({ id: 'session-1' }, mockSupabase)
		);

		expect(fail).toHaveBeenCalledWith(500, {
			error: '採点データの削除に失敗しました。delete failed'
		});
	});

	it('削除件数が 0 でも active_prompt_id をクリアして成功を返す', async () => {
		const mockSupabase = createCertMockSupabase();

		const mockAdminEq = vi.fn().mockResolvedValue({ error: null, count: 0 });
		vi.mocked(createClient).mockReturnValue({
			from: vi.fn().mockReturnValue({
				delete: vi.fn().mockReturnValue({ eq: mockAdminEq })
			})
		} as any);

		const result = await actions.deleteCertificationData(
			createActionArgs({ id: 'session-1' }, mockSupabase)
		);

		// active_prompt_id はクリアされる
		expect(mockSupabase._updateMock).toHaveBeenCalledWith({ active_prompt_id: null });

		expect(result).toEqual({
			success: true,
			message: '検定モードの採点データを削除しました。'
		});
	});

	it('active_prompt_id クリア失敗でもデータ削除自体は成功を返す', async () => {
		const mockSupabase = createCertMockSupabase({
			sessionUpdateError: { message: 'update failed' }
		});

		const mockAdminEq = vi.fn().mockResolvedValue({ error: null, count: 3 });
		vi.mocked(createClient).mockReturnValue({
			from: vi.fn().mockReturnValue({
				delete: vi.fn().mockReturnValue({ eq: mockAdminEq })
			})
		} as any);

		const result = await actions.deleteCertificationData(
			createActionArgs({ id: 'session-1' }, mockSupabase)
		);

		// エラーはログに出るが、成功として返る
		expect(result).toEqual({
			success: true,
			message: '検定モードの採点データを削除しました。'
		});
	});
});
