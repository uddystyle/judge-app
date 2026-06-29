# Realtime機能の動作確認チェックリスト

このチェックリストに従って、Realtime移行が正しく完了したか確認してください。

---

## Phase 1: Supabase設定の確認

### ✅ Step 1-1: Realtimeの有効化確認

**方法**: Supabase Dashboard

1. [ ] Supabase Dashboardにログイン
2. [ ] Database → Replication → Publications に移動
3. [ ] `supabase_realtime` publicationを開く
4. [ ] 以下のテーブルがリストに含まれているか確認:
   - [ ] `training_scores`
   - [ ] `results`
   - [ ] `sessions`

**含まれていない場合**:

Supabase Dashboard → SQL Editor で以下を実行:

```sql
ALTER PUBLICATION supabase_realtime ADD TABLE training_scores;
ALTER PUBLICATION supabase_realtime ADD TABLE results;
ALTER PUBLICATION supabase_realtime ADD TABLE sessions;
```

または、`scripts/apply-realtime-setup.sql`を実行

---

### ✅ Step 1-2: Replica Identityの設定

**方法**: Supabase Dashboard → SQL Editor

以下のSQLを実行:

```sql
-- 現在の設定を確認
SELECT
  c.relname as table_name,
  CASE c.relreplident
    WHEN 'd' THEN 'DEFAULT'
    WHEN 'f' THEN 'FULL ✅'
    ELSE 'OTHER ❌'
  END as replica_identity
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('training_scores', 'results', 'sessions')
ORDER BY c.relname;
```

**期待される結果**:
```
table_name       | replica_identity
-----------------+------------------
results          | FULL ✅
sessions         | FULL ✅
training_scores  | FULL ✅
```

**すべて「FULL ✅」でない場合**:

```sql
ALTER TABLE training_scores REPLICA IDENTITY FULL;
ALTER TABLE results REPLICA IDENTITY FULL;
ALTER TABLE sessions REPLICA IDENTITY FULL;
```

---

### ✅ Step 1-3: 総合確認

Supabase Dashboard → SQL Editor で `scripts/check-realtime-setup.sql` の内容を実行

**期待される出力**:
```
✅ すべての設定が完了しています！
```

---

## Phase 2: アプリケーション起動確認

### ✅ Step 2-1: 開発サーバーの起動

```bash
npm run dev
```

- [ ] サーバーが正常に起動した
- [ ] エラーが表示されない

---

### ✅ Step 2-2: ブラウザコンソールの確認

1. [ ] ブラウザを開く（Chrome推奨）
2. [ ] DevToolsを開く（F12 または Cmd+Option+I）
3. [ ] Consoleタブを選択

---

## Phase 3: 研修モードのスコア監視テスト

### ✅ Step 3-1: Realtime接続の確認

1. [ ] 主任検定員としてログイン
2. [ ] 研修モードのセッションを作成
3. [ ] スコア監視ページを開く
4. [ ] ブラウザコンソールで以下のログを確認:

**期待されるログ**:
```
[status/realtime] スコア監視のRealtime購読開始: training-scores-...
[status/realtime] スコア監視チャンネルの状態: SUBSCRIBED
[status/realtime] ✅ スコア監視のRealtime接続成功
```

**✅ 成功** / **❌ 失敗**（該当するものに✓）

---

### ✅ Step 3-2: リアルタイム更新の確認

**セットアップ**:
1. [ ] 主任検定員のブラウザ（ブラウザA）でスコア監視画面を開く
2. [ ] 別のブラウザ/シークレットウィンドウ（ブラウザB）で一般検定員としてログイン
3. [ ] ブラウザBで同じセッションに参加

**テスト実行**:
1. [ ] ブラウザBでスコアを入力（例: 85点）
2. [ ] ブラウザAの画面を確認

**期待される挙動**:
- [ ] **3秒待たずに**即座にスコアが表示される（0.5秒以内）
- [ ] ページリロードなし（画面フラッシュなし）
- [ ] ブラウザAのコンソールに以下のログ:
  ```
  [status/realtime] スコア変更を検知: {eventType: "INSERT"}
  [status/realtime] 新しいスコアを追加: [検定員名] 85
  ```

**✅ 成功** / **❌ 失敗**

---

### ✅ Step 3-3: 修正要求のテスト

**テスト実行**:
1. [ ] ブラウザAで「修正」ボタンをクリック
2. [ ] ブラウザBの挙動を確認

**期待される挙動**:
- [ ] ブラウザBが自動的に採点画面に遷移する
- [ ] ブラウザBのコンソールに以下のログ:
  ```
  [status/realtime] スコア変更を検知: {eventType: "DELETE"}
  [status/realtime] スコアを削除
  ```
- [ ] ブラウザAの画面からスコアが消える

**✅ 成功** / **❌ 失敗**

---

## Phase 4: 大会モードのスコア監視テスト

### ✅ Step 4-1: Realtime接続の確認

1. [ ] 大会モードのセッションを作成
2. [ ] スコア監視ページを開く
3. [ ] ブラウザコンソールで接続成功ログを確認

**期待されるログ**:
```
[status/realtime] スコア監視のRealtime購読開始: results-...
[status/realtime] ✅ スコア監視のRealtime接続成功
```

**✅ 成功** / **❌ 失敗**

---

### ✅ Step 4-2: リアルタイム更新の確認

（研修モードと同様のテスト）

- [ ] スコア入力後、即座に反映される
- [ ] ページリロードなし

**✅ 成功** / **❌ 失敗**

---

## Phase 5: スコアボードのテスト

### ✅ Step 5-1: Realtime接続の確認

1. [ ] スコアボードページを開く: `/scoreboard/[sessionId]`
2. [ ] ブラウザコンソールで接続成功ログを確認

**期待されるログ**:
```
[scoreboard] Realtime購読開始: scoreboard-...
[scoreboard] ✅ Realtime接続成功 - ポーリング不要
```

**✅ 成功** / **❌ 失敗**

---

### ✅ Step 5-2: リアルタイム更新の確認

**セットアップ**:
1. [ ] スコアボードをブラウザAで開く
2. [ ] 主任検定員のブラウザBで新しいスコアを確定

**期待される挙動**:
- [ ] **30秒待たずに**即座にスコアボードが更新される
- [ ] ブラウザAのコンソールに以下のログ:
  ```
  [scoreboard] スコア変更を検知 - リロード中... INSERT
  ```

**✅ 成功** / **❌ 失敗**

**注**: 現在の実装ではページリロードが発生します（将来の改善で差分更新に置き換え可能）

---

## Phase 6: パフォーマンス確認

### ✅ Step 6-1: ポーリングリクエストの削減確認

1. [ ] ブラウザのDevTools → Networkタブを開く
2. [ ] スコア監視ページを開く
3. [ ] 60秒間待機
4. [ ] リクエスト数を確認

**期待される結果**:
- [ ] `/api/score-status/` のようなポーリングリクエストが**ほぼゼロ**
- [ ] WebSocket接続が1つ存在: `wss://...supabase.co/realtime/v1/websocket`

**Before（ポーリング）**: 約20リクエスト/分
**After（Realtime）**: 0〜2リクエスト/分

**✅ 成功（90%削減達成）** / **❌ 失敗**

---

### ✅ Step 6-2: レイテンシーの測定

**測定方法**:
1. [ ] スコア入力画面で時計アプリを起動
2. [ ] スコアを入力してSubmit
3. [ ] 他のブラウザで表示されるまでの時間を測定

**期待される結果**:
- [ ] **0.5秒以内**に反映される

**Before**: 最大3秒
**After**: 0.5秒以内

**✅ 成功** / **❌ 失敗**

---

## Phase 7: セッション終了のテスト

### ✅ Step 7-1: リアルタイム終了検知

**セットアップ**:
1. [ ] 一般検定員のブラウザAでスコア監視画面を開く
2. [ ] 主任検定員のブラウザBで「検定を終了する」をクリック

**期待される挙動**:
- [ ] **3秒待たずに**即座にブラウザAが終了画面に遷移
- [ ] ブラウザAのコンソールに以下のログ:
  ```
  [一般検定員/status/realtime] 検定終了を検知（true→false） → 終了画面に遷移
  ```

**✅ 成功** / **❌ 失敗**

---

## 総合評価

### すべての項目にチェックを入れてください

**Phase 1: Supabase設定**
- [ ] Realtimeが有効化されている
- [ ] Replica IdentityがFULLに設定されている
- [ ] 総合確認スクリプトで成功メッセージが表示される

**Phase 2: アプリケーション起動**
- [ ] 開発サーバーが正常に起動する

**Phase 3: 研修モードのスコア監視**
- [ ] Realtime接続成功
- [ ] リアルタイム更新動作
- [ ] 修正要求動作

**Phase 4: 大会モードのスコア監視**
- [ ] Realtime接続成功
- [ ] リアルタイム更新動作

**Phase 5: スコアボード**
- [ ] Realtime接続成功
- [ ] リアルタイム更新動作

**Phase 6: パフォーマンス**
- [ ] ポーリングリクエスト90%削減
- [ ] レイテンシー0.5秒以内

**Phase 7: セッション終了**
- [ ] リアルタイム終了検知動作

---

## 結果

**✅ すべて成功**: Realtime移行は完了しています！本番環境へのデプロイに進めます。

**❌ 一部失敗**: `TESTING_GUIDE.md` のトラブルシューティングセクションを参照してください。

---

## 次のステップ

すべてのテストが成功したら:

1. [ ] このチェックリストを保存
2. [ ] 変更をコミット（既に完了）
3. [ ] 本番環境にデプロイ
4. [ ] 本番環境でも同様のテストを実施
5. [ ] ユーザーにフィードバックを依頼

---

**テスト実施日**: _______________
**テスト実施者**: _______________
**結果**: ✅ 成功 / ❌ 失敗
**備考**:
_______________________________________
_______________________________________
