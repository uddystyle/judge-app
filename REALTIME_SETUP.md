# Supabase Realtime設定ガイド

## 概要

このドキュメントでは、Supabase Realtimeを有効化するための設定手順を説明します。

---

## 必須設定（3ステップ）

### Step 1: Realtimeの有効化確認

#### 方法1: Supabase Dashboard（推奨）

1. Supabase Dashboard にログイン
2. **Database** → **Replication** → **Publications** に移動
3. `supabase_realtime` publication を確認
4. 以下のテーブルが含まれているか確認：
   - ✅ `training_scores`
   - ✅ `results`
   - ✅ `sessions`

含まれていない場合：
- 各テーブルの右側にある **Enable Realtime** トグルをONにする

#### 方法2: SQL Editor

```sql
-- 現在の設定を確認
SELECT schemaname, tablename
FROM pg_publication_tables
WHERE pubname = 'supabase_realtime'
  AND tablename IN ('training_scores', 'results', 'sessions');

-- テーブルが表示されない場合、以下を実行
ALTER PUBLICATION supabase_realtime ADD TABLE training_scores;
ALTER PUBLICATION supabase_realtime ADD TABLE results;
ALTER PUBLICATION supabase_realtime ADD TABLE sessions;
```

---

### Step 2: replica_identityの設定

DELETE時に`payload.old`で古い値を取得できるようにします。

#### SQL Editorで実行

```sql
-- FULLに設定（推奨）
ALTER TABLE training_scores REPLICA IDENTITY FULL;
ALTER TABLE results REPLICA IDENTITY FULL;
ALTER TABLE sessions REPLICA IDENTITY FULL;
```

**注意**: `REPLICA IDENTITY FULL`はWALログのサイズを増加させる可能性があります。ただし、DELETE時に`old`値が必要なため推奨されます。

---

### Step 3: RLSポリシーの確認

既存のRLSポリシーがそのまま適用されます。追加設定は不要です。

#### 確認用クエリ

```sql
-- 現在のRLSポリシーを確認
SELECT
  tablename,
  policyname,
  cmd,
  roles
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('training_scores', 'results', 'sessions')
ORDER BY tablename, policyname;
```

#### 期待される結果

- ✅ `training_scores`: セッション参加者のみ閲覧可能
- ✅ `results`: セッション参加者のみ閲覧可能
- ✅ `sessions`: セッション参加者のみ閲覧可能
- ✅ ゲストユーザーも`guest_identifier`でアクセス可能

---

## 動作確認

### 1. ブラウザコンソールで確認

1. アプリケーションにログイン
2. スコア監視ページまたはスコアボードを開く
3. ブラウザのDevToolsコンソールを開く
4. 以下のログが表示されることを確認：

```
[status/realtime] スコア監視のRealtime購読開始: training-scores-...
[status/realtime] スコア監視チャンネルの状態: SUBSCRIBED
[status/realtime] ✅ スコア監視のRealtime接続成功
```

エラーが表示される場合：
```
❌ Realtime接続エラー
```
→ Step 1のRealtime有効化を再確認してください。

### 2. リアルタイム更新のテスト

#### スコア監視のテスト

1. 主任検定員としてログイン
2. 検定員Aの採点状況確認画面を開く
3. 別のブラウザで検定員Bとしてログイン
4. 検定員Bがスコアを入力
5. 検定員Aの画面が**即座に**更新されることを確認（ポーリング待機なし）

#### スコアボードのテスト

1. スコアボードを開く
2. 別のブラウザで主任検定員としてログイン
3. 新しいスコアを確定
4. スコアボードが**即座に**更新されることを確認（30秒待機なし）

---

## トラブルシューティング

### 問題1: Realtime接続エラー

**症状**:
```
❌ Realtime接続エラー
CHANNEL_ERROR または TIMED_OUT
```

**解決策**:
1. Supabase Dashboardで該当テーブルのRealtime有効化を確認
2. ネットワーク接続を確認
3. Supabaseのステータスページを確認: https://status.supabase.com/

### 問題2: DELETEイベントで`payload.old`がnull

**症状**:
スコア削除時に、削除されたスコアの情報が取得できない

**解決策**:
```sql
-- replica_identityをFULLに設定
ALTER TABLE training_scores REPLICA IDENTITY FULL;
```

### 問題3: 他のユーザーのスコアが見える

**症状**:
他のセッションのスコアが表示される

**解決策**:
RLSポリシーを確認してください。migration 042で実装されているはずです。

```sql
-- 確認
SELECT * FROM pg_policies
WHERE tablename = 'training_scores';
```

---

## パフォーマンス指標

### Before（ポーリング）
- リクエスト数: 160 req/min（8ページ × 20req/min）
- レイテンシ: 最大3秒（スコア監視）、最大30秒（スコアボード）

### After（Realtime）
- リクエスト数: < 16 req/min（90%削減）
- レイテンシ: 0.5秒以下（リアルタイム）

---

## 参考リンク

- [Supabase Realtime Documentation](https://supabase.com/docs/guides/realtime)
- [Postgres REPLICA IDENTITY](https://www.postgresql.org/docs/current/sql-altertable.html#SQL-ALTERTABLE-REPLICA-IDENTITY)
- [Supabase RLS Policies](https://supabase.com/docs/guides/auth/row-level-security)

---

## クイックチェックリスト

完了したら✅をつけてください：

- [ ] Step 1: Realtime有効化（`training_scores`, `results`, `sessions`）
- [ ] Step 2: replica_identity設定（FULL）
- [ ] Step 3: RLSポリシー確認
- [ ] 動作確認1: ブラウザコンソールで接続成功を確認
- [ ] 動作確認2: スコア監視のリアルタイム更新を確認
- [ ] 動作確認3: スコアボードのリアルタイム更新を確認
