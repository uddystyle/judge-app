# セキュリティ強化機能のテスト計画

## 実装日
2026-03-11

## 概要

Realtime処理とJWT認証のセキュリティ強化で追加した機能について、テストが不足しています。
本ドキュメントは、追加すべきテストの計画を示します。

---

## テスト不足の現状

### ✅ 既存テスト（カバー済み）
- Realtime基本機能: 23テスト
- チャンネル接続・削除
- training_scores / results の監視
- 接続エラー・自己回復（指数バックオフ）
- N+1問題の検証
- パフォーマンステスト

### ❌ 今回実装でテスト未実装

| 機能 | テスト状況 | 優先度 |
|-----|----------|-------|
| JWT有効期限切れ処理 | ❌ なし | **HIGH** |
| ゲスト参加の原子性 | ❌ なし | **HIGH** |
| 同時採点Retryロジック | ❌ なし | **MEDIUM** |
| judge_name衝突（suffix） | ❌ なし | **MEDIUM** |
| previousPromptId同期 | ❌ なし | **MEDIUM** |
| RLS検証スクリプト | ⚠️ 手動のみ | **LOW** |

---

## 優先度HIGH: JWT関連テスト

### 1. JWT有効期限切れ処理

**ファイル**: `src/lib/supabaseClient.test.ts` (新規作成)

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createBrowserClient } from '@supabase/ssr';

describe('JWT Expiration Handling', () => {
  let mockSupabase: any;
  let authStateCallbacks: any[] = [];

  beforeEach(() => {
    // window.location.href のモック
    delete (window as any).location;
    (window as any).location = { href: '', pathname: '/session/123' };

    // Supabaseクライアントのモック
    mockSupabase = {
      auth: {
        onAuthStateChange: vi.fn((callback) => {
          authStateCallbacks.push(callback);
          return { data: { subscription: { unsubscribe: vi.fn() } } };
        })
      }
    };
  });

  it('TOKEN_REFRESHED イベントでログ出力される', () => {
    const consoleLogSpy = vi.spyOn(console, 'log');

    // supabaseClient.ts の処理をシミュレート
    mockSupabase.auth.onAuthStateChange((event: string) => {
      if (event === 'TOKEN_REFRESHED') {
        console.log('[supabaseClient] ✅ JWT refreshed successfully');
      }
    });

    // TOKEN_REFRESHED イベントを発火
    authStateCallbacks[0]('TOKEN_REFRESHED', { access_token: 'new_token' });

    expect(consoleLogSpy).toHaveBeenCalledWith('[supabaseClient] ✅ JWT refreshed successfully');
    consoleLogSpy.mockRestore();
  });

  it('SIGNED_OUT イベントで期限切れページにリダイレクトする', () => {
    (window as any).location.pathname = '/session/123/score/tournament/1/input';

    mockSupabase.auth.onAuthStateChange((event: string) => {
      if (event === 'SIGNED_OUT') {
        const currentPath = window.location.pathname;
        const isGuestSession = currentPath.includes('/session/');

        if (isGuestSession) {
          const sessionIdMatch = currentPath.match(/\/session\/(\d+)/);
          if (sessionIdMatch) {
            const sessionId = sessionIdMatch[1];
            window.location.href = `/session/${sessionId}?expired=true`;
          }
        }
      }
    });

    // SIGNED_OUT イベントを発火
    authStateCallbacks[0]('SIGNED_OUT', null);

    expect(window.location.href).toBe('/session/123?expired=true');
  });

  it('ゲストセッション以外のページでは何もしない', () => {
    (window as any).location.pathname = '/dashboard';
    const originalHref = window.location.href;

    mockSupabase.auth.onAuthStateChange((event: string) => {
      if (event === 'SIGNED_OUT') {
        const currentPath = window.location.pathname;
        const isGuestSession = currentPath.includes('/session/');

        if (isGuestSession) {
          // リダイレクト処理（実行されないはず）
          window.location.href = '/session/123?expired=true';
        }
      }
    });

    authStateCallbacks[0]('SIGNED_OUT', null);

    // リダイレクトされないことを確認
    expect(window.location.href).toBe(originalHref);
  });
});
```

---

### 2. ゲスト参加の原子性（ロールバック）

**ファイル**: `src/routes/session/join/+page.server.test.ts` (新規作成)

```typescript
import { describe, it, expect, vi } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';

describe('Guest Join - Atomic Transaction', () => {
  it('JWT発行失敗時に参加者レコードをロールバックする', async () => {
    const mockSupabase = {
      from: vi.fn((table: string) => {
        if (table === 'sessions') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn(() =>
                  Promise.resolve({
                    data: { id: 1, organization_id: 1, is_accepting_participants: true, join_code: 'ABC12345' },
                    error: null
                  })
                )
              }))
            }))
          };
        } else if (table === 'session_participants') {
          return {
            insert: vi.fn(() => Promise.resolve({ error: null })),
            delete: vi.fn(() => ({
              eq: vi.fn(() => Promise.resolve({ error: null }))
            }))
          };
        }
      }),
      auth: {
        signInAnonymously: vi.fn(() =>
          Promise.resolve({
            data: { session: null }, // ❌ JWT発行失敗
            error: { message: 'Anonymous sign-in failed' }
          })
        )
      }
    };

    // ゲスト参加処理のシミュレーション
    const guestIdentifier = 'test-guest-uuid';

    // Step 1: session_participants に INSERT
    await mockSupabase.from('session_participants').insert({
      session_id: 1,
      is_guest: true,
      guest_name: 'テストゲスト',
      guest_identifier: guestIdentifier
    });

    // Step 2: JWT発行（失敗）
    const { data: authData, error: authError } = await mockSupabase.auth.signInAnonymously();

    // Step 3: ロールバック
    if (authError || !authData.session) {
      await mockSupabase.from('session_participants').delete().eq('guest_identifier', guestIdentifier);
    }

    // 検証
    expect(authError).toBeTruthy();
    expect(mockSupabase.from('session_participants').delete).toHaveBeenCalled();
  });

  it('JWT発行成功時はロールバックしない', async () => {
    const mockSupabase = {
      from: vi.fn((table: string) => ({
        insert: vi.fn(() => Promise.resolve({ error: null })),
        delete: vi.fn(() => ({
          eq: vi.fn(() => Promise.resolve({ error: null }))
        }))
      })),
      auth: {
        signInAnonymously: vi.fn(() =>
          Promise.resolve({
            data: { session: { access_token: 'valid_token' } }, // ✅ JWT発行成功
            error: null
          })
        )
      }
    };

    const guestIdentifier = 'test-guest-uuid';

    await mockSupabase.from('session_participants').insert({
      session_id: 1,
      is_guest: true,
      guest_name: 'テストゲスト',
      guest_identifier: guestIdentifier
    });

    const { data: authData, error: authError } = await mockSupabase.auth.signInAnonymously();

    if (authError || !authData.session) {
      await mockSupabase.from('session_participants').delete().eq('guest_identifier', guestIdentifier);
    }

    // ロールバックされないことを確認
    expect(mockSupabase.from('session_participants').delete).not.toHaveBeenCalled();
  });
});
```

---

## 優先度MEDIUM: Retryロジックとjudge_name衝突

### 3. 同時採点Retryロジック

**ファイル**: `src/routes/session/[id]/score/[modeType]/[eventId]/input/+page.server.test.ts` (新規作成)

```typescript
import { describe, it, expect, vi } from 'vitest';

describe('Concurrent Scoring - Retry Logic', () => {
  it('SERIALIZATION FAILURE時に指数バックオフでリトライする', async () => {
    let attemptCount = 0;
    const retryDelays: number[] = [];

    const mockSupabase = {
      from: vi.fn(() => ({
        upsert: vi.fn(() => {
          attemptCount++;
          if (attemptCount < 3) {
            // 最初の2回は失敗
            return Promise.resolve({
              error: { code: '40001', message: 'SERIALIZATION FAILURE' }
            });
          } else {
            // 3回目で成功
            return Promise.resolve({ error: null });
          }
        })
      }))
    };

    // Retryロジック（実装と同じ）
    const MAX_RETRIES = 3;
    let insertError = null;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const { error } = await mockSupabase.from('results').upsert({
        session_id: 1,
        bib: 10,
        score: 85
      });

      if (!error) {
        insertError = null;
        break;
      }

      const errorCode = error.code;
      const isRetryable = errorCode === '40001' || errorCode === '40P01';

      if (!isRetryable) {
        insertError = error;
        break;
      }

      insertError = error;

      if (attempt < MAX_RETRIES - 1) {
        const delay = Math.min(100 * Math.pow(2, attempt) + Math.random() * 100, 1000);
        retryDelays.push(delay);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    // 検証
    expect(attemptCount).toBe(3);
    expect(insertError).toBeNull();
    expect(retryDelays).toHaveLength(2); // 1回目と2回目のみ遅延
    expect(retryDelays[0]).toBeGreaterThanOrEqual(100); // 1回目: 100ms + ランダム
    expect(retryDelays[1]).toBeGreaterThanOrEqual(200); // 2回目: 200ms + ランダム
  });

  it('リトライ不可能なエラーは即座に失敗する', async () => {
    let attemptCount = 0;

    const mockSupabase = {
      from: vi.fn(() => ({
        upsert: vi.fn(() => {
          attemptCount++;
          return Promise.resolve({
            error: { code: '23505', message: 'UNIQUE VIOLATION' } // リトライ不可能
          });
        })
      }))
    };

    const MAX_RETRIES = 3;
    let insertError = null;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const { error } = await mockSupabase.from('results').upsert({});

      if (!error) {
        insertError = null;
        break;
      }

      const errorCode = error.code;
      const isRetryable = errorCode === '40001' || errorCode === '40P01';

      if (!isRetryable) {
        insertError = error;
        break;
      }
    }

    // 1回だけ試行して即座に失敗
    expect(attemptCount).toBe(1);
    expect(insertError).toBeTruthy();
    expect(insertError.code).toBe('23505');
  });

  it('3回リトライしても失敗した場合はエラーを返す', async () => {
    let attemptCount = 0;

    const mockSupabase = {
      from: vi.fn(() => ({
        upsert: vi.fn(() => {
          attemptCount++;
          return Promise.resolve({
            error: { code: '40001', message: 'SERIALIZATION FAILURE' }
          });
        })
      }))
    };

    const MAX_RETRIES = 3;
    let insertError = null;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const { error } = await mockSupabase.from('results').upsert({});

      if (!error) {
        insertError = null;
        break;
      }

      insertError = error;
    }

    expect(attemptCount).toBe(3);
    expect(insertError).toBeTruthy();
    expect(insertError.code).toBe('40001');
  });
});
```

---

### 4. judge_name衝突（ゲスト名suffix）

**ファイル**: `src/routes/session/[id]/score/[modeType]/[eventId]/input/+page.server.test.ts`

```typescript
describe('judge_name Collision Prevention', () => {
  it('ゲスト名に " (ゲスト)" suffixが付与される', () => {
    const guestParticipant = {
      guest_name: '田中太郎',
      guest_identifier: 'guest-uuid'
    };

    let judgeName: string;
    if (guestParticipant) {
      judgeName = `${guestParticipant.guest_name} (ゲスト)`;
    }

    expect(judgeName).toBe('田中太郎 (ゲスト)');
  });

  it('認証ユーザーには suffixが付与されない', async () => {
    const user = { id: 'user-uuid', email: 'tanaka@example.com' };
    const profile = { full_name: '田中太郎' };

    let judgeName: string;
    if (user) {
      judgeName = profile?.full_name || user.email || 'Unknown';
    }

    expect(judgeName).toBe('田中太郎'); // suffixなし
  });

  it('同名のゲストと認証ユーザーが区別される', () => {
    const guestJudgeName = '田中太郎 (ゲスト)';
    const userJudgeName = '田中太郎';

    expect(guestJudgeName).not.toBe(userJudgeName);
  });
});
```

---

### 5. previousPromptId同期

**ファイル**: `src/routes/session/[id]/+page.test.ts` (新規作成)

```typescript
import { describe, it, expect, vi } from 'vitest';

describe('Fallback Polling - previousPromptId Sync', () => {
  it('Realtimeで採点指示を処理後、previousPromptIdが更新される', async () => {
    let previousPromptId: string | null = null;

    // Realtimeハンドラのシミュレーション
    const handleRealtimeUpdate = (payload: any) => {
      const newPromptId = payload.new.active_prompt_id;
      const oldPromptId = payload.old.active_prompt_id;

      if (newPromptId && oldPromptId !== newPromptId) {
        console.log('新しい採点指示を検知:', newPromptId);
        // ✅ previousPromptId を更新
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

  it('フォールバックポーリングが既に処理済みの指示を再検知しない', async () => {
    let previousPromptId: string | null = 'prompt-123';
    let transitionCalled = false;

    // フォールバックポーリングのシミュレーション
    const checkSessionStatus = async () => {
      const session = { active_prompt_id: 'prompt-123', status: 'active' };

      const newPromptId = session.active_prompt_id;
      if (newPromptId && newPromptId !== previousPromptId) {
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
        previousPromptId = newPromptId;
        transitionCalled = true;
      }
    };

    await checkSessionStatus();

    // 新しい指示のため、遷移する
    expect(transitionCalled).toBe(true);
    expect(previousPromptId).toBe('prompt-456');
  });
});
```

---

## 優先度LOW: RLS検証スクリプト

### 6. RLS検証スクリプトの自動化（オプション）

現在は手動実行のみ。CI/CDパイプラインに組み込むことを推奨。

**GitHub Actions例**:

```yaml
name: RLS Security Verification

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  verify-rls:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Run RLS Verification Script
        env:
          DATABASE_URL: ${{ secrets.STAGING_DATABASE_URL }}
        run: |
          psql $DATABASE_URL -f scripts/verify-rls-security.sql
          psql $DATABASE_URL -f scripts/verify-guest-session-isolation.sql
```

---

## テスト実行計画

### Phase 1: 即座に実装（優先度HIGH）
- [ ] JWT有効期限切れ処理（`supabaseClient.test.ts`）
- [ ] ゲスト参加の原子性（`join/+page.server.test.ts`、`invite/+page.server.test.ts`）

### Phase 2: 1週間以内（優先度MEDIUM）
- [ ] 同時採点Retryロジック（`input/+page.server.test.ts`）
- [ ] judge_name衝突（`input/+page.server.test.ts`）
- [ ] previousPromptId同期（`+page.test.ts`）

### Phase 3: 1ヶ月以内（優先度LOW）
- [ ] RLS検証スクリプトのCI/CD統合
- [ ] E2Eテストでの総合検証

---

## 手動テストチェックリスト

テスト実装が完了するまで、以下を手動で確認してください。

### JWT有効期限切れ
- [ ] ゲストで参加し、1時間以上放置
- [ ] 期限切れメッセージが表示されることを確認
- [ ] 再参加リンクから正常に再参加できることを確認

### ゲスト参加の原子性
- [ ] ネットワークを切断してゲスト参加を試行
- [ ] session_participants に orphan レコードが残らないことを確認
- [ ] エラーメッセージが表示されることを確認

### 同時採点Retry
- [ ] 2人の検定員が同時に同じ選手を採点
- [ ] エラーなく両方の採点が保存されることを確認
- [ ] DevToolsでRetryログが出力されることを確認

### judge_name衝突
- [ ] ゲスト「田中太郎」と認証ユーザー「田中太郎」を同一セッションに参加
- [ ] ゲストの名前が「田中太郎 (ゲスト)」として保存されることを確認
- [ ] それぞれの採点が独立して記録されることを確認

### previousPromptId同期
- [ ] Realtime接続中に採点指示を送信
- [ ] フォールバックポーリングが同じ指示を再検知しないことを確認
- [ ] DevToolsでログを確認

---

## まとめ

**現状**: 今回実装したセキュリティ強化機能の**大部分はテストされていません**。

**推奨アクション**:
1. **即座**: 優先度HIGHのテスト実装（JWT、原子性）
2. **1週間以内**: 優先度MEDIUMのテスト実装（Retry、judge_name、previousPromptId）
3. **並行**: 手動テストチェックリストで動作確認

**リスク評価**:
- テストなしでの本番デプロイは**HIGH RISK**
- 少なくとも優先度HIGHのテストを実装してからデプロイすることを強く推奨

---

**作成日**: 2026-03-11
**最終更新**: 2026-03-11
**ステータス**: ❌ テスト未実装
**優先度**: **CRITICAL**（本番デプロイ前に実装必須）
