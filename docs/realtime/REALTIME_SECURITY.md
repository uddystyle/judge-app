# Realtime セキュリティガイド

## 🚨 重要: RLSポリシーによるデータ保護

Supabase Realtimeを使用する場合、クライアント側のフィルタ条件だけでは**セキュリティは担保できません**。必ずSupabase側でRLS（Row Level Security）ポリシーを設定してください。

---

## セキュリティリスク

### ❌ 不適切な例

```sql
-- 危険: 全てのデータが見える
CREATE POLICY "Anyone can view all data"
  ON training_scores FOR SELECT
  TO anon
  USING (true);  -- ← 他セッションのデータも漏洩！
```

**問題点**:
- ゲストユーザーが全ての`training_scores`を閲覧可能
- セッションAのゲストがセッションBのスコアを取得できる
- Realtimeイベントで他セッションのデータが流れてくる

### ✅ 適切な例

```sql
-- 安全: セッション参加者のみ閲覧可能
CREATE POLICY "Anonymous users can view training scores in their sessions"
  ON training_scores FOR SELECT
  TO anon
  USING (
    event_id IN (
      SELECT te.id
      FROM training_events te
      JOIN sessions s ON s.id = te.session_id
      WHERE s.id IN (
        SELECT session_id
        FROM session_participants
        WHERE is_guest = true
      )
    )
  );
```

**改善点**:
- セッション参加者(`session_participants`)のチェック
- `event_id`を経由してセッションに紐付け
- 他セッションのデータは完全に隔離

---

## 現在のRLSポリシー

### 1. training_scores（研修モード）

#### Authenticated users（認証ユーザー）

```sql
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

-- INSERT: 自分のスコアのみ挿入可能
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
```

#### Anonymous users（ゲストユーザー）

```sql
-- SELECT: ゲストが参加しているセッションのみ閲覧可能
CREATE POLICY "Anonymous users can view training scores in their sessions"
  ON training_scores FOR SELECT
  TO anon
  USING (
    event_id IN (
      SELECT te.id
      FROM training_events te
      JOIN sessions s ON s.id = te.session_id
      WHERE s.id IN (
        SELECT session_id
        FROM session_participants
        WHERE is_guest = true
      )
    )
  );

-- INSERT: 有効なguest_identifierでのみ挿入可能
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

-- UPDATE: 自分のguest_identifierのスコアのみ更新可能
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
```

### 2. results（大会モード）

**⚠️ 重要な注意事項**:
- `results`テーブルは`judge_id`（UUID）ではなく、**`judge_name`（文字列）**を使用しています
- 認証ユーザーの場合、`profiles`テーブルから`full_name`を取得して照合します
- ゲストユーザーの場合、`session_participants.guest_name`と照合します

#### Authenticated users（認証ユーザー）

```sql
-- SELECT: 自分が参加しているセッションのみ閲覧可能
CREATE POLICY "Authenticated users can view results in their sessions"
  ON results FOR SELECT
  TO authenticated
  USING (
    session_id IN (
      SELECT session_id
      FROM session_participants
      WHERE user_id = auth.uid()
    )
  );

-- INSERT: 自分が参加しているセッションにのみ挿入可能
CREATE POLICY "Authenticated users can insert results in their sessions"
  ON results FOR INSERT
  TO authenticated
  WITH CHECK (
    session_id IN (
      SELECT session_id
      FROM session_participants
      WHERE user_id = auth.uid()
    )
  );

-- UPDATE: 自分のスコアのみ更新可能
-- Note: resultsテーブルはjudge_name（文字列）を使用
CREATE POLICY "Authenticated users can update their own results"
  ON results FOR UPDATE
  TO authenticated
  USING (
    judge_name IN (
      SELECT full_name
      FROM profiles
      WHERE id = auth.uid()
    )
  )
  WITH CHECK (
    judge_name IN (
      SELECT full_name
      FROM profiles
      WHERE id = auth.uid()
    )
  );

-- DELETE: 主任検定員のみ削除可能
CREATE POLICY "chief_judge_can_delete_results"
  ON results FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM sessions
      WHERE sessions.id = results.session_id
      AND sessions.chief_judge_id = auth.uid()
    )
  );
```

#### Anonymous users（ゲストユーザー）

```sql
-- SELECT: ゲストが参加しているセッションのみ閲覧可能
CREATE POLICY "Anonymous users can view results in sessions with guests"
  ON results FOR SELECT
  TO anon
  USING (
    session_id IN (
      SELECT DISTINCT session_id
      FROM session_participants
      WHERE is_guest = true
    )
  );

-- INSERT: 有効なguest_nameでのみ挿入可能
CREATE POLICY "Guests can insert results for sessions they participate in"
  ON results FOR INSERT
  TO anon
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM session_participants
      WHERE session_participants.session_id = results.session_id
      AND session_participants.is_guest = true
      AND session_participants.guest_name = results.judge_name
    )
  );

-- UPDATE: 自分のguest_nameのスコアのみ更新可能
CREATE POLICY "Guests can update their own results"
  ON results FOR UPDATE
  TO anon
  USING (
    EXISTS (
      SELECT 1 FROM session_participants
      WHERE session_participants.session_id = results.session_id
      AND session_participants.is_guest = true
      AND session_participants.guest_name = results.judge_name
    )
  );
```

### 3. sessions

```sql
-- Authenticated users
CREATE POLICY "Users can view sessions they participate in"
  ON sessions FOR SELECT
  TO authenticated
  USING (
    id IN (
      SELECT session_id
      FROM session_participants
      WHERE user_id = auth.uid()
    )
  );

-- Anonymous users (if implemented)
CREATE POLICY "Guests can view sessions they participate in"
  ON sessions FOR SELECT
  TO anon
  USING (
    id IN (
      SELECT DISTINCT session_id
      FROM session_participants
      WHERE is_guest = true
    )
  );
```

---

## Realtime設定

### 1. Publication設定

```sql
-- Realtimeで公開するテーブルを指定
ALTER PUBLICATION supabase_realtime ADD TABLE training_scores;
ALTER PUBLICATION supabase_realtime ADD TABLE results;
ALTER PUBLICATION supabase_realtime ADD TABLE sessions;
```

### 2. Replica Identity設定

```sql
-- DELETE時に古い値を取得できるようにする
ALTER TABLE training_scores REPLICA IDENTITY FULL;
ALTER TABLE results REPLICA IDENTITY FULL;
ALTER TABLE sessions REPLICA IDENTITY FULL;
```

### 3. RLS有効化

```sql
-- RLSが有効化されていることを確認
ALTER TABLE training_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE results ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
```

---

## クライアント側の実装

### フィルター条件の役割

クライアント側のフィルター条件（例: `filter: 'event_id=eq.123'`）は:
- ✅ **性能最適化**: 不要なイベントの受信を減らす
- ✅ **利便性**: 必要なデータのみ処理
- ❌ **セキュリティ保証ではない**: RLSが主防衛線

### 例: 研修モード

```typescript
scoreRealtimeChannel = supabase
  .channel(channelName)
  .on(
    'postgres_changes',
    {
      event: '*',
      schema: 'public',
      table: 'training_scores',
      filter: `event_id=eq.${eventId}`  // ← 性能最適化のためのフィルタ
    },
    (payload) => {
      // RLSにより、既にセッション内のデータのみ受信している
      // クライアント側で追加のbib_numberフィルタリング
      if (payload.new?.bib_number === bib) {
        // 処理
      }
    }
  )
  .subscribe();
```

**重要**: `filter`パラメータは**性能最適化**のためであり、セキュリティは**RLSポリシー**で保証されます。

---

## セキュリティ検証手順

### 1. RLSポリシーの確認

```sql
-- 現在のRLSポリシーを確認
SELECT
  tablename,
  policyname,
  roles,
  cmd,
  qual
FROM pg_policies
WHERE tablename IN ('training_scores', 'results', 'sessions')
ORDER BY tablename, cmd, policyname;
```

### 2. クロスセッションアクセステスト

**テスト手順**:
1. セッションAを作成（judge_1で参加）
2. セッションBを作成（judge_2で参加）
3. judge_1でセッションBのデータにRealtimeアクセスを試みる
4. **期待結果**: アクセス拒否（RLSにより自動的にフィルタされる）

**検証コード**:
```typescript
// judge_1 (Session Aの参加者)
const channel = supabase
  .channel('test-cross-session')
  .on(
    'postgres_changes',
    {
      event: '*',
      schema: 'public',
      table: 'training_scores',
      filter: `event_id=eq.${sessionB_eventId}`  // Session Bのevent_id
    },
    (payload) => {
      console.log('❌ SECURITY BREACH:', payload); // 到達してはいけない
    }
  )
  .subscribe();

// Session BでINSERTを実行
// → judge_1にはイベントが届かない（RLSで保護）
```

### 3. ゲストユーザーの隔離テスト

**テスト手順**:
1. セッションAにゲストAを招待
2. セッションBにゲストBを招待
3. ゲストA（anon認証）でセッションBのデータにアクセス
4. **期待結果**: セッションBのデータは見えない

---

## トラブルシューティング

### 問題: Realtimeイベントが届かない

**原因1**: RLSポリシーが厳しすぎる
```sql
-- 現在のポリシーを確認
SELECT * FROM pg_policies WHERE tablename = 'training_scores';
```

**原因2**: Publicationにテーブルが含まれていない
```sql
-- Publication確認
SELECT * FROM pg_publication_tables
WHERE pubname = 'supabase_realtime'
  AND tablename = 'training_scores';
```

**原因3**: RLSが無効化されている
```sql
-- RLS有効化確認
SELECT relname, relrowsecurity
FROM pg_class
WHERE relname IN ('training_scores', 'results', 'sessions');
```

### 問題: 他セッションのデータが見える

**原因**: RLSポリシーが `USING (true)` になっている

**修正**:
```bash
# マイグレーション実行
psql $DATABASE_URL -f database/migrations/999_fix_rls_realtime_security.sql
```

---

## ベストプラクティス

### ✅ DO

1. **RLSポリシーでセッション隔離を保証**
   ```sql
   USING (session_id IN (SELECT session_id FROM session_participants WHERE user_id = auth.uid()))
   ```

2. **クライアント側のフィルタは性能最適化のため**
   ```typescript
   filter: `event_id=eq.${eventId}`  // 不要なイベントを減らす
   ```

3. **定期的なセキュリティ監査**
   - 四半期ごとにRLSポリシーをレビュー
   - クロスセッションアクセステストを実施

### ❌ DON'T

1. **`USING (true)` を使わない**
   ```sql
   USING (true)  -- ❌ 全データが見える
   ```

2. **クライアント側のフィルタだけに依存しない**
   ```typescript
   // ❌ RLSがないとセキュリティリスク
   if (payload.new.session_id !== mySessionId) return;
   ```

3. **ゲスト識別をクライアント側だけで行わない**
   ```typescript
   // ❌ クライアント側の検証だけでは不十分
   if (guestIdentifier === myGuest) { ... }
   ```

---

## 参考資料

- [Supabase Realtime Documentation](https://supabase.com/docs/guides/realtime)
- [Row Level Security (RLS)](https://supabase.com/docs/guides/auth/row-level-security)
- [PostgreSQL Replication](https://www.postgresql.org/docs/current/logical-replication.html)

---

**最終更新**: 2026-03-11
**作成者**: Claude Opus 4.5
**重要度**: 🚨 CRITICAL SECURITY
