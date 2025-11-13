# 研修モード ゲストユーザー機能追加 ロードマップ

## 概要

研修モードに大会モードと同様のゲストユーザー機能を追加するための実装計画。

**目的**:
- 研修セッションに招待されたゲストユーザーが、認証なしで採点に参加できるようにする
- 大会モードと同じユーザー体験を提供

**前提条件**:
- 大会モードのゲストユーザー機能は実装済み（Migration 010, 032-039）
- 研修モードの基本機能は実装済み（Migration 004-006）
- `session_participants`テーブルのゲスト対応は完了

---

## 現状分析（2025-11-13 データベース確認済み）

### 実装済み機能

- ✅ `session_participants`テーブルのゲスト対応（`is_guest`, `guest_name`, `guest_identifier`）
- ✅ セッション招待機能（`invite_token`, `join_code`）
- ✅ 大会モードでのゲストユーザー採点フロー
- ✅ 研修モードの基本機能（`training_sessions`, `training_events`, `training_scores`）
- ✅ 統合採点画面（`/score/[modeType]/[eventId]/*`）

### 未実装・問題点

- ❌ `training_scores`テーブルへのゲストユーザースコア挿入
- ❌ `training_scores`のRLSポリシーがゲスト非対応
- ❌ 採点確認画面（status）でのゲスト名表示ロジック
- ❌ 修正要求機能のゲスト対応

### データベース確認結果

**開発環境と本番環境の違い**:
- 本番環境: RLSポリシー3つ + パフォーマンスインデックス4つ + `unique_training_score`制約あり
- 開発環境: RLS有効だがポリシー未設定、基本インデックスのみ

**重要な発見**:
1. `judge_id`に外部キー制約なし（auth.usersへの参照なし）→ スキーマ変更が容易
2. 本番環境に`unique_training_score`制約あり: `(event_id, judge_id, athlete_id)` → 部分インデックスでの再作成が必要
3. 開発環境にRLSポリシーなし → マイグレーションで追加が必要

---

## 技術的課題

### 1. データベーススキーマの問題

**現在の構造**（データベース確認済み）:
```sql
CREATE TABLE training_scores (
  id bigserial PRIMARY KEY,
  event_id bigint NOT NULL REFERENCES training_events(id) ON DELETE CASCADE,
  judge_id uuid NOT NULL,  -- ← 外部キー制約なし（auth.usersへの参照なし）
  athlete_id bigint NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  score numeric NOT NULL,
  is_finalized boolean DEFAULT false,
  note text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),

  -- 本番環境のみ存在:
  CONSTRAINT unique_training_score UNIQUE (event_id, judge_id, athlete_id)
);

-- 本番環境のインデックス:
CREATE INDEX idx_training_scores_event ON training_scores(event_id);
CREATE INDEX idx_training_scores_judge ON training_scores(judge_id);
CREATE INDEX idx_training_scores_athlete ON training_scores(athlete_id);
CREATE INDEX idx_training_scores_finalized ON training_scores(is_finalized);
```

**問題点**:
- `judge_id`はNOT NULL制約あり（ゲストユーザーはUUIDを持たない）
- 本番環境の`unique_training_score`制約が`judge_id`を含む → 部分インデックスでの再作成が必要
- RLSポリシーが`auth.uid()`に依存（本番環境のみ）

### 2. RLSポリシーの問題

**現在のポリシー**（本番環境のみ、開発環境はポリシー未設定）:
```sql
-- SELECT
CREATE POLICY "Judges can view their own scores"
  ON training_scores FOR SELECT
  USING ((judge_id = auth.uid()) OR (event_id IN (...)));

-- INSERT
CREATE POLICY "Judges can insert their own scores"
  ON training_scores FOR INSERT
  WITH CHECK ((judge_id = auth.uid()) AND (event_id IN (...)));

-- UPDATE
CREATE POLICY "Judges can update their own scores"
  ON training_scores FOR UPDATE
  USING (judge_id = auth.uid())
  WITH CHECK (judge_id = auth.uid());
```

**問題点**:
- `auth.uid()`はゲストユーザーで`null`を返す
- ゲストユーザーはスコアを挿入・更新・削除できない
- 開発環境ではRLS有効だがポリシー未設定 → マイグレーションで追加が必要

---

## 実装アプローチ

### アプローチA: judge_idをnullable化 + guest_identifier追加（推奨）

**利点**:
- データ整合性を維持
- 既存のauth.users参照を壊さない
- ゲストと認証ユーザーを明確に区別

**欠点**:
- スキーマ変更が必要
- 既存クエリの修正が必要

### アプローチB: 仮のauth.usersレコードを作成

**利点**:
- スキーマ変更不要
- 既存ロジックをそのまま使用可能

**欠点**:
- auth.usersテーブルを汚染
- セキュリティリスク
- Supabase Authとの整合性問題

### アプローチC: judge_nameカラムを追加

**利点**:
- シンプル
- 名前解決が高速

**欠点**:
- データ正規化違反
- profilesテーブルとの二重管理

**決定**: **アプローチA**を採用

---

## 実装ロードマップ

### Phase 1: データベーススキーマ修正（最優先）

#### タスク1-1: training_scoresテーブル拡張

**ファイル**: `database/migrations/041_add_guest_support_to_training_scores.sql`

**本番環境での実行内容**:
```sql
-- 1. judge_idをnullable化
ALTER TABLE training_scores ALTER COLUMN judge_id DROP NOT NULL;

-- 2. guest_identifier追加
ALTER TABLE training_scores ADD COLUMN guest_identifier TEXT;

-- 3. 制約: judge_idまたはguest_identifierのどちらか必須
ALTER TABLE training_scores ADD CONSTRAINT check_judge_or_guest
  CHECK (
    (judge_id IS NOT NULL AND guest_identifier IS NULL) OR
    (judge_id IS NULL AND guest_identifier IS NOT NULL)
  );

-- 4. 既存のユニーク制約を削除（本番環境のみ存在）
DROP INDEX IF EXISTS unique_training_score;

-- 5. 部分インデックスでユニーク制約を再作成
-- 認証ユーザー用
CREATE UNIQUE INDEX idx_training_scores_unique_auth
  ON training_scores(event_id, judge_id, athlete_id)
  WHERE judge_id IS NOT NULL;

-- ゲストユーザー用
CREATE UNIQUE INDEX idx_training_scores_unique_guest
  ON training_scores(event_id, guest_identifier, athlete_id)
  WHERE guest_identifier IS NOT NULL;

-- 6. 開発環境のパフォーマンスインデックスを追加（本番環境には既存）
CREATE INDEX IF NOT EXISTS idx_training_scores_event ON training_scores(event_id);
CREATE INDEX IF NOT EXISTS idx_training_scores_judge ON training_scores(judge_id);
CREATE INDEX IF NOT EXISTS idx_training_scores_athlete ON training_scores(athlete_id);
CREATE INDEX IF NOT EXISTS idx_training_scores_finalized ON training_scores(is_finalized);

-- 7. ゲスト用のインデックスを追加
CREATE INDEX idx_training_scores_guest_identifier ON training_scores(guest_identifier) WHERE guest_identifier IS NOT NULL;
```

**所要時間**: 30分

---

#### タスク1-2: RLSポリシー更新

**ファイル**: `database/migrations/042_update_training_scores_rls_for_guests.sql`

**本番環境と開発環境での実行内容**:
```sql
-- 既存ポリシーを削除（本番環境のみ存在）
DROP POLICY IF EXISTS "Judges can view their own scores" ON training_scores;
DROP POLICY IF EXISTS "Judges can insert their own scores" ON training_scores;
DROP POLICY IF EXISTS "Judges can update their own scores" ON training_scores;

-- ====================================================================
-- 認証ユーザー用ポリシー（authenticated role）
-- ====================================================================

-- SELECT: セッション参加者は全スコアを閲覧可能
CREATE POLICY "Authenticated users can view training scores in their sessions"
  ON training_scores FOR SELECT
  TO authenticated
  USING (
    event_id IN (
      SELECT te.id
      FROM training_events te
      JOIN sessions s ON s.id = te.session_id
      WHERE s.id IN (
        SELECT session_id
        FROM session_participants
        WHERE user_id = auth.uid()
      )
    )
  );

-- INSERT: 自分のスコアのみ挿入可能（セッション参加者であること）
CREATE POLICY "Authenticated users can insert their own training scores"
  ON training_scores FOR INSERT
  TO authenticated
  WITH CHECK (
    judge_id = auth.uid()
    AND event_id IN (
      SELECT te.id
      FROM training_events te
      WHERE te.session_id IN (
        SELECT session_id
        FROM session_participants
        WHERE user_id = auth.uid()
      )
    )
  );

-- UPDATE: 自分のスコアのみ更新可能
CREATE POLICY "Authenticated users can update their own training scores"
  ON training_scores FOR UPDATE
  TO authenticated
  USING (judge_id = auth.uid())
  WITH CHECK (judge_id = auth.uid());

-- DELETE: 削除ポリシーは不要（修正要求は削除ではなくis_finalized管理）

-- ====================================================================
-- ゲストユーザー用ポリシー（anon role）
-- ====================================================================

-- SELECT: ゲストも全スコアを閲覧可能（training_events、sessionsへのアクセスが必要）
CREATE POLICY "Anonymous users can view training scores"
  ON training_scores FOR SELECT
  TO anon
  USING (true);

-- INSERT: ゲストは自分のguest_identifierでスコアを挿入可能
CREATE POLICY "Anonymous users can insert training scores"
  ON training_scores FOR INSERT
  TO anon
  WITH CHECK (
    guest_identifier IS NOT NULL
    AND guest_identifier IN (
      SELECT guest_identifier
      FROM session_participants
      WHERE is_guest = true
    )
  );

-- UPDATE: ゲストは自分のスコアのみ更新可能
CREATE POLICY "Anonymous users can update their own training scores"
  ON training_scores FOR UPDATE
  TO anon
  USING (
    guest_identifier IS NOT NULL
    AND guest_identifier IN (
      SELECT guest_identifier
      FROM session_participants
      WHERE is_guest = true
    )
  )
  WITH CHECK (
    guest_identifier IS NOT NULL
    AND guest_identifier IN (
      SELECT guest_identifier
      FROM session_participants
      WHERE is_guest = true
    )
  );

-- DELETE: 削除ポリシーは不要
```

**注意事項**:
- 開発環境にはRLSポリシーが存在しないため、このマイグレーションで初めて設定されます
- `training_events`と`sessions`テーブルへの匿名アクセスポリシーも必要（Migration 039で大会モード用に追加済み）
- 修正要求機能は削除ではなく`is_finalized`フラグ管理で実装されているため、DELETEポリシーは不要

**所要時間**: 45分

---

### Phase 2: アプリケーションロジック修正

#### タスク2-1: 採点入力画面（input）の修正

**ファイル**: `src/routes/session/[id]/score/[modeType]/[eventId]/input/+page.server.ts`

**変更箇所**: `submitScore`アクション

```typescript
// 現在のコード（抜粋）
if (isTrainingMode) {
  const { error } = await supabase
    .from('training_scores')
    .insert({
      event_id: eventId,
      judge_id: user.id,  // ← ゲスト対応必要
      athlete_id: participantId,
      score: score,
      is_finalized: true
    });
}

// 修正後
if (isTrainingMode) {
  const scoreData: any = {
    event_id: eventId,
    athlete_id: participantId,
    score: score,
    is_finalized: true
  };

  if (guestParticipant) {
    // ゲストユーザーの場合
    scoreData.guest_identifier = guestParticipant.guest_identifier;
  } else {
    // 認証ユーザーの場合
    scoreData.judge_id = user.id;
  }

  const { error } = await supabase
    .from('training_scores')
    .insert(scoreData);

  if (error) {
    console.error('[submitScore] Error inserting training score:', error);
    return fail(500, { error: `スコアの保存に失敗しました。${error.message}` });
  }
}
```

**所要時間**: 30分

---

#### タスク2-2: 採点確認画面（status）の修正

**ファイル**: `src/routes/session/[id]/score/[modeType]/[eventId]/status/+page.server.ts`

**変更箇所**: `load`関数の検定員名解決ロジック

```typescript
// 現在のコード（抜粋）
if (isTrainingMode) {
  const scoresWithNames = await Promise.all(
    trainingScores.map(async (s: any) => {
      const { data: profile } = await supabase
        .from('profiles')
        .select('full_name')
        .eq('id', s.judge_id)  // ← ゲストの場合エラー
        .single();

      return {
        judge_name: profile?.full_name || '不明',
        score: s.score
      };
    })
  );
}

// 修正後
if (isTrainingMode) {
  const scoresWithNames = await Promise.all(
    trainingScores.map(async (s: any) => {
      let judge_name = '不明';

      if (s.guest_identifier) {
        // ゲストユーザーの場合
        const { data: guestData } = await supabase
          .from('session_participants')
          .select('guest_name')
          .eq('guest_identifier', s.guest_identifier)
          .single();

        judge_name = guestData?.guest_name || 'ゲスト';
      } else if (s.judge_id) {
        // 認証ユーザーの場合
        const { data: profile } = await supabase
          .from('profiles')
          .select('full_name')
          .eq('id', s.judge_id)
          .single();

        judge_name = profile?.full_name || '不明';
      }

      return {
        judge_name,
        score: s.score,
        is_guest: !!s.guest_identifier
      };
    })
  );
}
```

**所要時間**: 30分

---

#### タスク2-3: 修正要求機能の修正

**ファイル**: `src/routes/session/[id]/score/[modeType]/[eventId]/status/+page.server.ts`

**変更箇所**: `requestRevision`アクション

```typescript
// 現在のコード（抜粋）
requestRevision: async ({ request, params, locals: { supabase } }) => {
  const formData = await request.formData();
  const judgeId = formData.get('judgeId') as string;

  const { error } = await supabase
    .from('training_scores')
    .delete()
    .eq('event_id', eventId)
    .eq('judge_id', judgeId)  // ← ゲスト対応必要
    .eq('athlete_id', participantId);
}

// 修正後
requestRevision: async ({ request, params, locals: { supabase } }) => {
  const formData = await request.formData();
  const judgeId = formData.get('judgeId') as string;
  const guestIdentifier = formData.get('guestIdentifier') as string;

  let query = supabase
    .from('training_scores')
    .delete()
    .eq('event_id', eventId)
    .eq('athlete_id', participantId);

  if (guestIdentifier) {
    // ゲストユーザーのスコアを削除
    query = query.eq('guest_identifier', guestIdentifier);
  } else {
    // 認証ユーザーのスコアを削除
    query = query.eq('judge_id', judgeId);
  }

  const { error } = await query;

  if (error) {
    console.error('[requestRevision] Error deleting score:', error);
    return fail(500, { error: '修正要求に失敗しました。' });
  }

  return { success: true };
}
```

**フロントエンド修正**:
`src/routes/session/[id]/score/[modeType]/[eventId]/status/+page.svelte`

```svelte
<!-- 修正要求ボタン -->
<form method="POST" action="?/requestRevision">
  <input type="hidden" name="judgeId" value={score.judge_id || ''} />
  <input type="hidden" name="guestIdentifier" value={score.guest_identifier || ''} />
  <button type="submit">修正要求</button>
</form>
```

**所要時間**: 45分

---

#### タスク2-4: ゲストユーザー認証の確認

**ファイル**: `src/routes/session/[id]/score/[modeType]/[eventId]/+page.server.ts`

**確認箇所**: `load`関数のゲストユーザー認証

```typescript
// 既存コード（確認のみ）
const guestIdentifier = url.searchParams.get('guest');

if (!user && guestIdentifier) {
  const { data: guestData, error: guestError } = await supabase
    .from('session_participants')
    .select('*')
    .eq('session_id', sessionId)
    .eq('guest_identifier', guestIdentifier)
    .eq('is_guest', true)
    .single();

  if (guestError || !guestData) {
    throw redirect(303, '/session/join');
  }

  guestParticipant = guestData;
}
```

**確認事項**:
- ✅ 研修モードでもこのロジックが動作することを確認
- ✅ `guestParticipant`が正しく下流に渡されることを確認

**所要時間**: 15分

---

### Phase 3: テストと検証

#### タスク3-1: 手動テスト

**テストケース**:

1. **ゲストユーザーの招待と参加**
   - [ ] 研修セッション作成
   - [ ] QRコード/招待リンク生成
   - [ ] ゲストユーザーとして参加
   - [ ] `session_participants`にゲストレコードが作成されることを確認

2. **ゲストユーザーの採点**
   - [ ] 主任検定員がゼッケンを入力
   - [ ] ゲストユーザーがスコアを入力
   - [ ] `training_scores`にゲストのスコアが保存されることを確認
   - [ ] `guest_identifier`が正しく設定されることを確認

3. **採点確認画面**
   - [ ] 主任検定員が採点確認画面を表示
   - [ ] ゲストユーザーの名前が正しく表示されることを確認
   - [ ] スコアが正しく表示されることを確認

4. **修正要求**
   - [ ] 主任検定員がゲストユーザーのスコアに修正要求
   - [ ] ゲストユーザーのスコアが削除されることを確認
   - [ ] ゲストユーザーが再入力画面に遷移することを確認

5. **複数検定員モード**
   - [ ] `is_multi_judge = true`で研修セッション作成
   - [ ] ゲストユーザーが待機画面に正しく遷移することを確認
   - [ ] 主任検定員が採点指示を出すことを確認
   - [ ] ゲストユーザーが採点画面に遷移することを確認

**所要時間**: 2時間

---

#### タスク3-2: エッジケースの確認

**確認事項**:

1. **RLSポリシーの動作確認**
   - [ ] ゲストユーザーが他のセッションのスコアを見れないことを確認
   - [ ] ゲストユーザーが自分のスコアのみを編集・削除できることを確認

2. **データ整合性**
   - [ ] 同じゲストが同じ選手に対して複数回スコアを入力できないことを確認
   - [ ] `judge_id`と`guest_identifier`の両方が設定されたレコードが作成されないことを確認

3. **セッション終了時の動作**
   - [ ] 主任検定員がセッションを終了
   - [ ] ゲストユーザーが終了画面に遷移することを確認

**所要時間**: 1時間

---

### Phase 4: ドキュメント更新

#### タスク4-1: 技術ドキュメント更新

**ファイル**: `docs/guest-user-specification.md`

**追加内容**:
- 研修モードのゲストユーザー対応について記載
- `training_scores`テーブルのスキーマ説明
- RLSポリシーの説明

**所要時間**: 30分

---

#### タスク4-2: マイグレーションガイド更新

**ファイル**: `database/migrations/README.md`

**追加内容**:
- Migration 041, 042の説明
- ロールバック手順

**所要時間**: 15分

---

## 実装順序とスケジュール

### Week 1: データベース基盤（Phase 1）

| タスク | 所要時間 | 担当 | 状態 |
|-------|---------|------|------|
| 1-1: training_scoresテーブル拡張 | 30分 | - | 未着手 |
| 1-2: RLSポリシー更新 | 45分 | - | 未着手 |

**完了条件**: マイグレーションが本番環境で実行され、エラーなく完了すること

---

### Week 2: アプリケーションロジック（Phase 2）

| タスク | 所要時間 | 担当 | 状態 |
|-------|---------|------|------|
| 2-1: 採点入力画面修正 | 30分 | - | 未着手 |
| 2-2: 採点確認画面修正 | 30分 | - | 未着手 |
| 2-3: 修正要求機能修正 | 45分 | - | 未着手 |
| 2-4: ゲスト認証確認 | 15分 | - | 未着手 |

**完了条件**: すべてのコード修正が完了し、コンパイルエラーがないこと

---

### Week 3: テストと検証（Phase 3）

| タスク | 所要時間 | 担当 | 状態 |
|-------|---------|------|------|
| 3-1: 手動テスト | 2時間 | - | 未着手 |
| 3-2: エッジケース確認 | 1時間 | - | 未着手 |

**完了条件**: すべてのテストケースがパスすること

---

### Week 4: ドキュメントとリリース（Phase 4）

| タスク | 所要時間 | 担当 | 状態 |
|-------|---------|------|------|
| 4-1: 技術ドキュメント更新 | 30分 | - | 未着手 |
| 4-2: マイグレーションガイド更新 | 15分 | - | 未着手 |

**完了条件**: ドキュメントが最新化され、リリースノートが作成されること

---

## 総所要時間

| Phase | 所要時間 |
|-------|---------|
| Phase 1: データベース | 1時間15分 |
| Phase 2: アプリケーション | 2時間 |
| Phase 3: テスト | 3時間 |
| Phase 4: ドキュメント | 45分 |
| **合計** | **7時間** |

---

## リスクと対策

### リスク1: RLSポリシーの複雑性

**リスク**: RLSポリシーが複雑すぎて、意図しない権限漏洩が発生する可能性

**対策**:
- ポリシーを段階的にテスト
- 開発環境で十分なテストを実施
- 本番環境では最初に読み取り専用ポリシーのみを有効化

**優先度**: HIGH

---

### リスク2: データ移行

**リスク**: 既存の`training_scores`データがスキーマ変更で破損する可能性

**対策**:
- マイグレーション前にバックアップ取得
- `ALTER TABLE`は既存データに影響しない（`judge_id`をnullable化、新カラム追加）
- ロールバックスクリプトを用意

**優先度**: MEDIUM

---

### リスク3: パフォーマンス劣化

**リスク**: RLSポリシーの複雑化でクエリパフォーマンスが低下する可能性

**対策**:
- インデックスを適切に設定
- `EXPLAIN ANALYZE`でクエリプランを確認
- 必要に応じてポリシーを最適化

**優先度**: LOW

---

## 成功指標

### 機能要件

- [ ] ゲストユーザーが研修セッションに参加できる
- [ ] ゲストユーザーがスコアを入力できる
- [ ] ゲストユーザーのスコアが採点確認画面に表示される
- [ ] 主任検定員がゲストユーザーのスコアに修正要求できる
- [ ] 複数検定員モードでゲストユーザーが正しく動作する

### 非機能要件

- [ ] RLSポリシーが正しく機能し、権限漏洩がない
- [ ] パフォーマンスが大会モードと同等
- [ ] データ整合性が保たれている
- [ ] ドキュメントが最新化されている

---

## 参考資料

### 関連マイグレーション
- `004_add_training_mode.sql` - 研修モード基本機能
- `005_add_multi_judge_to_training.sql` - 複数検定員モード
- `006_fix_training_scores_judge_id.sql` - judge_id型修正
- `010_add_guest_user_support.sql` - ゲストユーザー基盤
- `039_comprehensive_guest_access_fix.sql` - 大会モードゲスト対応

### 関連ドキュメント
- `docs/guest-user-specification.md` - ゲストユーザー仕様
- `TRAINING_MODE_IMPLEMENTATION_GUIDE.md` - 研修モード実装ガイド

### 関連ファイル
- `src/routes/session/[id]/score/[modeType]/[eventId]/input/+page.server.ts`
- `src/routes/session/[id]/score/[modeType]/[eventId]/status/+page.server.ts`
- `src/routes/session/[id]/training-events/+page.server.ts`

---

## 変更履歴

| 日付 | 変更内容 | 担当 |
|-----|---------|------|
| 2025-11-13 | 初版作成 | - |
| 2025-11-13 | データベース確認結果を反映、マイグレーションSQLを更新 | - |

---

## 次のステップ

1. このロードマップをレビュー
2. Phase 1のマイグレーションSQLを作成
3. 開発環境でマイグレーションをテスト
4. Phase 2のコード修正を開始
