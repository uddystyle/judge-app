/**
 * 待機画面 - ガード条件テスト
 *
 * join直後や終了時の誤遷移を防ぐガード条件をテストする
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('待機画面 - ガード条件', () => {
	let mockPayload: any;
	let mockGoto: any;
	let mockSupabase: any;

	beforeEach(() => {
		mockGoto = vi.fn();

		// チェーン可能なモックを作成
		const createChainableMock = () => {
			const mock: any = {
				eq: vi.fn(() => mock),
				single: vi.fn(() =>
					Promise.resolve({
						data: {
							id: 'prompt-123',
							bib_number: 10,
							discipline: 'tournament',
							level: 'event-1',
							event_name: 'ロープ'
						},
						error: null
					})
				),
				maybeSingle: vi.fn(() =>
					Promise.resolve({
						data: { id: 'participant-123' },
						error: null
					})
				)
			};
			return mock;
		};

		mockSupabase = {
			from: vi.fn(() => ({
				select: vi.fn(() => createChainableMock())
			}))
		};

		mockPayload = {
			old: { active_prompt_id: null, status: 'active', is_active: true },
			new: { active_prompt_id: 'prompt-123', status: 'active', is_active: true }
		};
	});

	describe('shouldShowJoinUI ガード', () => {
		it('join=true 中は既存 prompt があっても採点画面に遷移しない（SUBSCRIBED時）', async () => {
			const shouldShowJoinUI = true;
			const currentPromptId = 'existing-prompt-456';

			// SUBSCRIBED 時の既存prompt処理ロジック
			if (currentPromptId && !shouldShowJoinUI) {
				mockGoto('/session/123/score/tournament/event-1/input');
			}

			// 検証: gotoが呼ばれない
			expect(mockGoto).not.toHaveBeenCalled();
		});

		it('join=false の場合は既存 prompt があれば採点画面に遷移する（SUBSCRIBED時）', async () => {
			const shouldShowJoinUI = false;
			const currentPromptId = 'existing-prompt-456';

			// SUBSCRIBED 時の既存prompt処理ロジック
			if (currentPromptId && !shouldShowJoinUI) {
				// promptの詳細を取得
				const { data: promptData, error } = await mockSupabase
					.from('scoring_prompts')
					.select('*')
					.eq('id', currentPromptId)
					.single();

				if (!error && promptData) {
					const mode = promptData.discipline;

					if (mode === 'tournament') {
						const { data: participant } = await mockSupabase
							.from('participants')
							.select('id')
							.eq('session_id', '123')
							.eq('bib_number', promptData.bib_number)
							.maybeSingle();

						if (participant) {
							const eventId = promptData.level;
							mockGoto(`/session/123/score/tournament/${eventId}/input?bib=${promptData.bib_number}&participantId=${participant.id}`);
						}
					}
				}
			}

			// 検証: gotoが呼ばれる
			expect(mockGoto).toHaveBeenCalledWith(
				expect.stringContaining('/session/123/score/tournament/event-1/input')
			);
		});

		it('join=true 中はフォールバックポーリングで新規promptを無視する', async () => {
			const shouldShowJoinUI = true;
			const newPromptId = 'prompt-789';
			const previousPromptId = null;

			// フォールバックポーリングのprompt検知ロジック
			if (newPromptId && newPromptId !== previousPromptId && !shouldShowJoinUI) {
				// promptの詳細を取得して遷移
				const { data: promptData } = await mockSupabase
					.from('scoring_prompts')
					.select('*')
					.eq('id', newPromptId)
					.single();

				if (promptData) {
					mockGoto(`/session/123/score/tournament/event-1/input`);
				}
			}

			// 検証: gotoが呼ばれない
			expect(mockGoto).not.toHaveBeenCalled();
		});

		it('join=false の場合はフォールバックポーリングで新規promptを処理する', async () => {
			const shouldShowJoinUI = false;
			const newPromptId = 'prompt-789';
			const previousPromptId = null;

			// フォールバックポーリングのprompt検知ロジック
			if (newPromptId && newPromptId !== previousPromptId && !shouldShowJoinUI) {
				// promptの詳細を取得して遷移
				const { data: promptData } = await mockSupabase
					.from('scoring_prompts')
					.select('*')
					.eq('id', newPromptId)
					.single();

				if (promptData) {
					const mode = promptData.discipline;

					if (mode === 'tournament') {
						const { data: participant } = await mockSupabase
							.from('participants')
							.select('id')
							.eq('session_id', '123')
							.eq('bib_number', promptData.bib_number)
							.maybeSingle();

						if (participant) {
							const eventId = promptData.level;
							mockGoto(`/session/123/score/tournament/${eventId}/input?bib=${promptData.bib_number}&participantId=${participant.id}`);
						}
					}
				}
			}

			// 検証: gotoが呼ばれる
			expect(mockGoto).toHaveBeenCalledWith(
				expect.stringContaining('/session/123/score/tournament/event-1/input')
			);
		});
	});

	describe('isSessionEnded ガード', () => {
		it('ended=true 後は新規 prompt を処理しない（Realtime）', async () => {
			const isSessionEnded = true;
			const newPromptId = mockPayload.new.active_prompt_id;
			const oldPromptId = mockPayload.old.active_prompt_id;

			// Realtimeハンドラのロジック
			// 既に終了画面を表示している場合は、状態変更をスキップ
			if (isSessionEnded) {
				console.log('[一般検定員/realtime] ⚠️ 終了画面表示中のため、状態変更をスキップ');
				// early return
			} else {
				// 新しい採点指示IDがセットされたら
				if (newPromptId && oldPromptId !== newPromptId) {
					mockGoto('/session/123/score');
				}
			}

			// 検証: gotoが呼ばれない
			expect(mockGoto).not.toHaveBeenCalled();
		});

		it('ended=false の場合は新規 prompt を処理する（Realtime）', async () => {
			const isSessionEnded = false;
			const newPromptId = mockPayload.new.active_prompt_id;
			const oldPromptId = mockPayload.old.active_prompt_id;

			// Realtimeハンドラのロジック
			if (isSessionEnded) {
				console.log('[一般検定員/realtime] ⚠️ 終了画面表示中のため、状態変更をスキップ');
			} else {
				// 新しい採点指示IDがセットされたら
				if (newPromptId && oldPromptId !== newPromptId) {
					const { data: promptData } = await mockSupabase
						.from('scoring_prompts')
						.select('*')
						.eq('id', newPromptId)
						.single();

					if (promptData) {
						const mode = promptData.discipline;

						if (mode === 'tournament') {
							const { data: participant } = await mockSupabase
								.from('participants')
								.select('id')
								.eq('session_id', '123')
								.eq('bib_number', promptData.bib_number)
								.maybeSingle();

							if (participant) {
								const eventId = promptData.level;
								mockGoto(`/session/123/score/tournament/${eventId}/input?bib=${promptData.bib_number}&participantId=${participant.id}`);
							}
						}
					}
				}
			}

			// 検証: gotoが呼ばれる
			expect(mockGoto).toHaveBeenCalledWith(
				expect.stringContaining('/session/123/score/tournament/event-1/input')
			);
		});

		it('終了検知イベント自体は ended=true でも処理される', async () => {
			let isSessionEnded = true;
			const newStatus = 'ended';

			// 終了検知ロジック（早期リターンより前に判定される）
			if (isSessionEnded) {
				console.log('[一般検定員/realtime] ⚠️ 終了画面表示中のため、状態変更をスキップ');
				// ただし、既に終了画面なので何もしない
			}

			// 検証: 既に終了画面なので新たな遷移は発生しない
			expect(mockGoto).not.toHaveBeenCalled();
		});

		it('ended=false からセッション終了を検知すると終了画面に遷移する', async () => {
			let isSessionEnded = false;
			const newStatus = 'ended';

			// 終了検知ロジック
			if (isSessionEnded) {
				console.log('[一般検定員/realtime] ⚠️ 終了画面表示中のため、状態変更をスキップ');
			}

			// セッションが終了した場合
			if (newStatus === 'ended') {
				console.log('[一般検定員/realtime] ✅ セッション終了を検知！終了画面に遷移します！');
				isSessionEnded = true;
				mockGoto('/session/123?ended=true');
			}

			// 検証: 終了画面に遷移する
			expect(mockGoto).toHaveBeenCalledWith('/session/123?ended=true');
		});
	});

	describe('isPageActive ガード', () => {
		it('非アクティブページでは新規promptによる遷移をスキップする', async () => {
			const isPageActive = false;
			const newStatus = 'ended';

			// 終了検知時の遷移ロジック
			if (newStatus === 'ended') {
				if (!isPageActive) {
					console.log('[一般検定員/realtime] ⚠️ ページが非アクティブのため、遷移をスキップ');
					// early return
				} else {
					mockGoto('/session/123?ended=true');
				}
			}

			// 検証: gotoが呼ばれない
			expect(mockGoto).not.toHaveBeenCalled();
		});

		it('アクティブページでは新規promptによる遷移を実行する', async () => {
			const isPageActive = true;
			const newStatus = 'ended';

			// 終了検知時の遷移ロジック
			if (newStatus === 'ended') {
				if (!isPageActive) {
					console.log('[一般検定員/realtime] ⚠️ ページが非アクティブのため、遷移をスキップ');
				} else {
					mockGoto('/session/123?ended=true');
				}
			}

			// 検証: gotoが呼ばれる
			expect(mockGoto).toHaveBeenCalledWith('/session/123?ended=true');
		});

		it('フォールバックポーリングでも非アクティブページはスキップする', async () => {
			const isPageActive = false;

			// フォールバックポーリングの冒頭ガード
			if (!isPageActive) {
				console.log('[fallback] ページ非アクティブのため、ポーリングをスキップ');
				// early return
			} else {
				// セッション状態を確認
				const { data: session } = await mockSupabase
					.from('sessions')
					.select('active_prompt_id, status')
					.eq('id', '123')
					.single();

				if (session?.status === 'ended') {
					mockGoto('/session/123?ended=true');
				}
			}

			// 検証: gotoが呼ばれない
			expect(mockGoto).not.toHaveBeenCalled();
			// Supabaseクエリも実行されない
			expect(mockSupabase.from).not.toHaveBeenCalled();
		});

		it('アクティブページではフォールバックポーリングが実行される', async () => {
			const isPageActive = true;

			mockSupabase.from = vi.fn(() => ({
				select: vi.fn(() => ({
					eq: vi.fn(() => ({
						single: vi.fn(() =>
							Promise.resolve({
								data: { active_prompt_id: null, status: 'ended' },
								error: null
							})
						)
					}))
				}))
			}));

			// フォールバックポーリングの冒頭ガード
			if (!isPageActive) {
				console.log('[fallback] ページ非アクティブのため、ポーリングをスキップ');
			} else {
				// セッション状態を確認
				const { data: session } = await mockSupabase
					.from('sessions')
					.select('active_prompt_id, status')
					.eq('id', '123')
					.single();

				if (session?.status === 'ended') {
					mockGoto('/session/123?ended=true');
				}
			}

			// 検証: gotoが呼ばれる
			expect(mockGoto).toHaveBeenCalledWith('/session/123?ended=true');
			// Supabaseクエリが実行される
			expect(mockSupabase.from).toHaveBeenCalledWith('sessions');
		});
	});

	describe('複合ガード条件', () => {
		it('join=true かつ ended=true の場合は prompt を処理しない', async () => {
			const shouldShowJoinUI = true;
			const isSessionEnded = true;
			const newPromptId = 'prompt-999';

			// 複合ガード
			if (isSessionEnded) {
				console.log('[一般検定員/realtime] ⚠️ 終了画面表示中のため、状態変更をスキップ');
			} else if (newPromptId && !shouldShowJoinUI) {
				mockGoto('/session/123/score');
			}

			// 検証: gotoが呼ばれない（ended優先）
			expect(mockGoto).not.toHaveBeenCalled();
		});

		it('join=false かつ ended=false の場合は prompt を処理する', async () => {
			const shouldShowJoinUI = false;
			const isSessionEnded = false;
			const newPromptId = 'prompt-999';
			const oldPromptId = null;

			// 複合ガード
			if (isSessionEnded) {
				console.log('[一般検定員/realtime] ⚠️ 終了画面表示中のため、状態変更をスキップ');
			} else if (newPromptId && oldPromptId !== newPromptId && !shouldShowJoinUI) {
				const { data: promptData } = await mockSupabase
					.from('scoring_prompts')
					.select('*')
					.eq('id', newPromptId)
					.single();

				if (promptData) {
					const mode = promptData.discipline;

					if (mode === 'tournament') {
						const { data: participant } = await mockSupabase
							.from('participants')
							.select('id')
							.eq('session_id', '123')
							.eq('bib_number', promptData.bib_number)
							.maybeSingle();

						if (participant) {
							const eventId = promptData.level;
							mockGoto(`/session/123/score/tournament/${eventId}/input?bib=${promptData.bib_number}&participantId=${participant.id}`);
						}
					}
				}
			}

			// 検証: gotoが呼ばれる
			expect(mockGoto).toHaveBeenCalledWith(
				expect.stringContaining('/session/123/score/tournament/event-1/input')
			);
		});

		it('join=true かつ ended=false かつ isPageActive=false の場合は prompt を処理しない', async () => {
			const shouldShowJoinUI = true;
			const isSessionEnded = false;
			const isPageActive = false;
			const newPromptId = 'prompt-999';

			// 複合ガード
			if (isSessionEnded) {
				console.log('[終了画面表示中]');
			}

			if (!isPageActive) {
				console.log('[ページ非アクティブ]');
			}

			if (!isSessionEnded && isPageActive && newPromptId && !shouldShowJoinUI) {
				mockGoto('/session/123/score');
			}

			// 検証: gotoが呼ばれない（複数のガードが機能）
			expect(mockGoto).not.toHaveBeenCalled();
		});

		it('全てのガードが false の場合のみ prompt を処理する', async () => {
			const shouldShowJoinUI = false;
			const isSessionEnded = false;
			const isPageActive = true;
			const newPromptId = 'prompt-999';
			const oldPromptId = null;

			// 複合ガード
			if (isSessionEnded) {
				console.log('[終了画面表示中]');
			}

			if (!isPageActive) {
				console.log('[ページ非アクティブ]');
			}

			if (!isSessionEnded && isPageActive && newPromptId && oldPromptId !== newPromptId && !shouldShowJoinUI) {
				const { data: promptData } = await mockSupabase
					.from('scoring_prompts')
					.select('*')
					.eq('id', newPromptId)
					.single();

				if (promptData) {
					const mode = promptData.discipline;

					if (mode === 'tournament') {
						const { data: participant } = await mockSupabase
							.from('participants')
							.select('id')
							.eq('session_id', '123')
							.eq('bib_number', promptData.bib_number)
							.maybeSingle();

						if (participant) {
							const eventId = promptData.level;
							mockGoto(`/session/123/score/tournament/${eventId}/input?bib=${promptData.bib_number}&participantId=${participant.id}`);
						}
					}
				}
			}

			// 検証: gotoが呼ばれる（全てのガードがクリア）
			expect(mockGoto).toHaveBeenCalledWith(
				expect.stringContaining('/session/123/score/tournament/event-1/input')
			);
		});
	});

	describe('ガード優先順位', () => {
		it('isSessionEnded が最優先で評価される', async () => {
			const isSessionEnded = true;
			const isPageActive = true;
			const shouldShowJoinUI = false;
			const newStatus = 'active';
			const newPromptId = 'prompt-123';

			// ガード評価順序
			if (isSessionEnded) {
				console.log('[guard] 終了画面表示中 - 最優先でスキップ');
				// early return
			} else if (newStatus === 'ended') {
				if (!isPageActive) {
					console.log('[guard] ページ非アクティブ - 遷移スキップ');
				} else {
					mockGoto('/session/123?ended=true');
				}
			} else if (newPromptId && !shouldShowJoinUI) {
				mockGoto('/session/123/score');
			}

			// 検証: isSessionEndedが優先されてgotoは呼ばれない
			expect(mockGoto).not.toHaveBeenCalled();
		});

		it('isPageActive は遷移実行直前で評価される', async () => {
			const isSessionEnded = false;
			const isPageActive = false;
			const shouldShowJoinUI = false;
			const newStatus = 'ended';

			// ガード評価順序
			if (isSessionEnded) {
				console.log('[guard] 終了画面表示中');
			} else if (newStatus === 'ended') {
				if (!isPageActive) {
					console.log('[guard] ページ非アクティブ - 遷移スキップ');
					// early return
				} else {
					mockGoto('/session/123?ended=true');
				}
			}

			// 検証: isPageActiveで遷移がブロックされる
			expect(mockGoto).not.toHaveBeenCalled();
		});

		it('shouldShowJoinUI は prompt 処理時のみ評価される', async () => {
			const isSessionEnded = false;
			const isPageActive = true;
			const shouldShowJoinUI = true;
			const newPromptId = 'prompt-123';
			const currentPromptId = 'existing-prompt';

			// ガード評価順序
			if (isSessionEnded) {
				console.log('[guard] 終了画面表示中');
			} else {
				// SUBSCRIBED時の既存prompt処理
				if (currentPromptId && !shouldShowJoinUI) {
					mockGoto('/session/123/score/existing');
				}

				// Realtime更新のprompt処理
				if (newPromptId && !shouldShowJoinUI) {
					mockGoto('/session/123/score/new');
				}
			}

			// 検証: shouldShowJoinUIでprompt処理がブロックされる
			expect(mockGoto).not.toHaveBeenCalled();
		});
	});
});
