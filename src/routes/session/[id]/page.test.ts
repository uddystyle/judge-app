/**
 * Fallback Polling - previousPromptId Sync テスト
 *
 * Realtimeとフォールバックポーリングの状態同期（previousPromptId）をテストし、
 * 二重遷移を防ぐロジックを検証します
 */

import { describe, it, expect, vi } from 'vitest';

describe('Fallback Polling - previousPromptId Sync', () => {
	it('Realtimeで採点指示を処理後、previousPromptIdが更新される', async () => {
		let previousPromptId: string | null = null;

		// Realtimeハンドラのシミュレーション
		const handleRealtimeUpdate = (payload: any) => {
			const newPromptId = payload.new.active_prompt_id;
			const oldPromptId = payload.old.active_prompt_id;

			if (newPromptId && oldPromptId !== newPromptId) {
				console.log('[一般検定員] 新しい採点指示を検知:', newPromptId);
				// ✅ フォールバックポーリングとの二重処理を防ぐため、ここで previousPromptId を更新
				previousPromptId = newPromptId;
				// ... 採点画面に遷移
			}
		};

		// Realtimeイベントを発火
		handleRealtimeUpdate({
			old: { active_prompt_id: null },
			new: { active_prompt_id: 'prompt-123' }
		});

		expect(previousPromptId).toBe('prompt-123');
	});

	it('SUBSCRIBED時に既存の採点指示を処理後、previousPromptIdが更新される', () => {
		let previousPromptId: string | null = null;
		const sessionDetails = { active_prompt_id: 'existing-prompt-456' };
		const shouldShowJoinUI = false;

		// SUBSCRIBED時の既存採点指示チェックのシミュレーション
		const currentPromptId = sessionDetails.active_prompt_id;
		if (currentPromptId && !shouldShowJoinUI) {
			console.log('[一般検定員] 既存の採点指示を検知:', currentPromptId);
			// ✅ フォールバックポーリングとの二重処理を防ぐため、ここで previousPromptId を更新
			previousPromptId = currentPromptId;
			// ... 採点画面に遷移
		}

		expect(previousPromptId).toBe('existing-prompt-456');
	});

	it('フォールバックポーリングが既に処理済みの指示を再検知しない', async () => {
		let previousPromptId: string | null = 'prompt-123';
		let transitionCalled = false;

		// フォールバックポーリングのシミュレーション
		const checkSessionStatus = async () => {
			const session = { active_prompt_id: 'prompt-123', status: 'active' };

			const newPromptId = session.active_prompt_id;
			if (newPromptId && newPromptId !== previousPromptId) {
				console.log('[fallback] ✅ 新しい採点指示を検知（ポーリング）:', newPromptId);
				previousPromptId = newPromptId;
				transitionCalled = true; // 採点画面に遷移
			}
		};

		await checkSessionStatus();

		// 既に処理済みのため、遷移しない
		expect(transitionCalled).toBe(false);
		expect(previousPromptId).toBe('prompt-123');
	});

	it('新しい採点指示の場合のみフォールバックポーリングが遷移する', async () => {
		let previousPromptId: string | null = 'prompt-123';
		let transitionCalled = false;

		const checkSessionStatus = async () => {
			const session = { active_prompt_id: 'prompt-456', status: 'active' };

			const newPromptId = session.active_prompt_id;
			if (newPromptId && newPromptId !== previousPromptId) {
				console.log('[fallback] ✅ 新しい採点指示を検知（ポーリング）:', newPromptId);
				previousPromptId = newPromptId;
				transitionCalled = true;
			}
		};

		await checkSessionStatus();

		// 新しい指示のため、遷移する
		expect(transitionCalled).toBe(true);
		expect(previousPromptId).toBe('prompt-456');
	});

	it('Realtime処理後、フォールバックポーリングが同じ指示を検知しない（統合）', async () => {
		let previousPromptId: string | null = null;
		let realtimeTransitionCount = 0;
		let pollingTransitionCount = 0;

		// Realtimeハンドラ
		const handleRealtimeUpdate = (payload: any) => {
			const newPromptId = payload.new.active_prompt_id;
			const oldPromptId = payload.old.active_prompt_id;

			if (newPromptId && oldPromptId !== newPromptId) {
				// ✅ previousPromptId を更新
				previousPromptId = newPromptId;
				realtimeTransitionCount++;
			}
		};

		// フォールバックポーリング
		const checkSessionStatus = async () => {
			const session = { active_prompt_id: 'prompt-789', status: 'active' };

			const newPromptId = session.active_prompt_id;
			if (newPromptId && newPromptId !== previousPromptId) {
				previousPromptId = newPromptId;
				pollingTransitionCount++;
			}
		};

		// ステップ1: Realtimeで採点指示を受信
		handleRealtimeUpdate({
			old: { active_prompt_id: null },
			new: { active_prompt_id: 'prompt-789' }
		});

		expect(realtimeTransitionCount).toBe(1);
		expect(previousPromptId).toBe('prompt-789');

		// ステップ2: フォールバックポーリングが実行される（30秒後を想定）
		await checkSessionStatus();

		// 同じ指示なので、ポーリングでは遷移しない
		expect(pollingTransitionCount).toBe(0);
		expect(previousPromptId).toBe('prompt-789'); // 変更なし

		// 合計遷移回数は1回のみ
		expect(realtimeTransitionCount + pollingTransitionCount).toBe(1);
	});

	it('Realtime失敗時、フォールバックポーリングが新しい指示を検知する', async () => {
		let previousPromptId: string | null = 'prompt-100';
		let realtimeTransitionCount = 0;
		let pollingTransitionCount = 0;

		// Realtime接続失敗をシミュレート（イベント受信なし）

		// フォールバックポーリングのみ動作
		const checkSessionStatus = async () => {
			const session = { active_prompt_id: 'prompt-200', status: 'active' };

			const newPromptId = session.active_prompt_id;
			if (newPromptId && newPromptId !== previousPromptId) {
				previousPromptId = newPromptId;
				pollingTransitionCount++;
			}
		};

		// ポーリングで新しい指示を検知
		await checkSessionStatus();

		expect(realtimeTransitionCount).toBe(0); // Realtimeは動作しない
		expect(pollingTransitionCount).toBe(1); // ポーリングで検知
		expect(previousPromptId).toBe('prompt-200');
	});

	it('複数回のRealtime更新でpreviousPromptIdが正しく追跡される', () => {
		let previousPromptId: string | null = null;
		const transitionHistory: string[] = [];

		const handleRealtimeUpdate = (payload: any) => {
			const newPromptId = payload.new.active_prompt_id;
			const oldPromptId = payload.old.active_prompt_id;

			if (newPromptId && oldPromptId !== newPromptId) {
				previousPromptId = newPromptId;
				transitionHistory.push(newPromptId);
			}
		};

		// 連続したRealtime更新
		handleRealtimeUpdate({
			old: { active_prompt_id: null },
			new: { active_prompt_id: 'prompt-1' }
		});

		handleRealtimeUpdate({
			old: { active_prompt_id: 'prompt-1' },
			new: { active_prompt_id: 'prompt-2' }
		});

		handleRealtimeUpdate({
			old: { active_prompt_id: 'prompt-2' },
			new: { active_prompt_id: 'prompt-3' }
		});

		// 検証
		expect(transitionHistory).toEqual(['prompt-1', 'prompt-2', 'prompt-3']);
		expect(previousPromptId).toBe('prompt-3');
	});

	it('null → 有効ID への遷移が正しく処理される', () => {
		let previousPromptId: string | null = null;
		let transitionCalled = false;

		const handleRealtimeUpdate = (payload: any) => {
			const newPromptId = payload.new.active_prompt_id;
			const oldPromptId = payload.old.active_prompt_id;

			if (newPromptId && oldPromptId !== newPromptId) {
				previousPromptId = newPromptId;
				transitionCalled = true;
			}
		};

		handleRealtimeUpdate({
			old: { active_prompt_id: null },
			new: { active_prompt_id: 'first-prompt' }
		});

		expect(transitionCalled).toBe(true);
		expect(previousPromptId).toBe('first-prompt');
	});

	it('同じIDへの更新は無視される', () => {
		let previousPromptId: string | null = 'prompt-same';
		let transitionCount = 0;

		const handleRealtimeUpdate = (payload: any) => {
			const newPromptId = payload.new.active_prompt_id;
			const oldPromptId = payload.old.active_prompt_id;

			if (newPromptId && oldPromptId !== newPromptId) {
				previousPromptId = newPromptId;
				transitionCount++;
			}
		};

		// 同じIDの更新
		handleRealtimeUpdate({
			old: { active_prompt_id: 'prompt-same' },
			new: { active_prompt_id: 'prompt-same' }
		});

		// 遷移しない
		expect(transitionCount).toBe(0);
		expect(previousPromptId).toBe('prompt-same');
	});
});

describe('Fallback Polling - Session End Detection', () => {
	it('セッション終了をフォールバックポーリングで検知する', async () => {
		let isSessionEnded = false;
		let redirectCalled = false;

		const checkSessionStatus = async () => {
			const session = { active_prompt_id: 'prompt-123', status: 'ended' };

			// 終了検知
			if (session.status === 'ended' && !isSessionEnded) {
				console.log('[fallback] ✅ セッション終了を検知（ポーリング）');
				isSessionEnded = true;
				redirectCalled = true; // goto(`/session/${sessionId}?ended=true`)
			}
		};

		await checkSessionStatus();

		expect(isSessionEnded).toBe(true);
		expect(redirectCalled).toBe(true);
	});

	it('既に終了状態の場合は重複処理しない', async () => {
		let isSessionEnded = true; // 既に終了済み
		let redirectCallCount = 0;

		const checkSessionStatus = async () => {
			const session = { active_prompt_id: null, status: 'ended' };

			if (session.status === 'ended' && !isSessionEnded) {
				isSessionEnded = true;
				redirectCallCount++;
			}
		};

		await checkSessionStatus();

		// 既に終了済みなので、リダイレクトは呼ばれない
		expect(redirectCallCount).toBe(0);
		expect(isSessionEnded).toBe(true);
	});
});

describe('Fallback Polling - previousPromptId 巻き戻し防止', () => {
	it('Realtime処理後、フォールバックポーリング再開時にpreviousPromptIdを巻き戻さない', () => {
		let previousPromptId: string | null = null;
		let fallbackPolling: any = null;
		const sessionDetails = { active_prompt_id: 'prompt-1' };

		// フォールバックポーリング開始関数のシミュレーション
		const startFallbackPolling = () => {
			if (fallbackPolling) {
				console.log('[fallback] 既にポーリング開始済み');
				return;
			}

			// ✅ previousPromptId が null の場合のみ初期化（巻き戻し防止）
			if (previousPromptId === null) {
				previousPromptId = sessionDetails.active_prompt_id;
				console.log('[fallback] previousPromptId を初期化:', previousPromptId);
			} else {
				console.log('[fallback] previousPromptId を保持:', previousPromptId);
			}

			fallbackPolling = 'polling-timer';
		};

		// 初回開始: previousPromptId が null なので初期化される
		startFallbackPolling();
		expect(previousPromptId).toBe('prompt-1');

		// Realtime で prompt-2 を処理
		previousPromptId = 'prompt-2';
		expect(previousPromptId).toBe('prompt-2');

		// 接続エラーでフォールバックポーリング再開
		fallbackPolling = null; // ポーリングが停止したと仮定
		startFallbackPolling();

		// ✅ previousPromptId が巻き戻されないことを確認
		expect(previousPromptId).toBe('prompt-2'); // 'prompt-1'に戻ってはいけない
	});

	it('初回開始時のみpreviousPromptIdを初期化する', () => {
		let previousPromptId: string | null = null;
		let fallbackPolling: any = null;
		const sessionDetails = { active_prompt_id: 'prompt-initial' };

		const startFallbackPolling = () => {
			if (fallbackPolling) {
				return;
			}

			if (previousPromptId === null) {
				previousPromptId = sessionDetails.active_prompt_id;
			}

			fallbackPolling = 'polling-timer';
		};

		// 初回開始
		startFallbackPolling();
		expect(previousPromptId).toBe('prompt-initial');

		// 2回目の開始（previousPromptIdは既に値がある）
		previousPromptId = 'prompt-updated';
		fallbackPolling = null;
		startFallbackPolling();

		// previousPromptIdは上書きされない
		expect(previousPromptId).toBe('prompt-updated');
	});

	it('Realtime処理後の再開で二重遷移が発生しない', () => {
		let previousPromptId: string | null = null;
		let gotoCallCount = 0;
		const sessionDetails = { active_prompt_id: 'prompt-old' }; // ページロード時の古い値

		const startFallbackPolling = () => {
			if (previousPromptId === null) {
				previousPromptId = sessionDetails.active_prompt_id;
			}
		};

		const checkSessionStatus = async () => {
			const currentPrompt = 'prompt-new';

			if (currentPrompt && currentPrompt !== previousPromptId) {
				gotoCallCount++;
				previousPromptId = currentPrompt;
			}
		};

		// 初回開始
		startFallbackPolling();
		expect(previousPromptId).toBe('prompt-old');

		// Realtime で prompt-new を処理
		previousPromptId = 'prompt-new';
		gotoCallCount++;

		// 接続エラーでフォールバックポーリング再開
		startFallbackPolling();

		// previousPromptId は 'prompt-new' のまま（巻き戻されない）
		expect(previousPromptId).toBe('prompt-new');

		// ポーリングで最新データ取得
		checkSessionStatus();

		// ✅ 二重遷移は発生しない（goto は Realtime の1回のみ）
		expect(gotoCallCount).toBe(1);
	});
});
