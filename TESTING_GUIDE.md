# Realtime機能の動作確認ガイド

このガイドでは、Supabase Realtimeの動作確認手順を説明します。

---

## 前提条件

- ✅ Supabase設定が完了していること（`REALTIME_SETUP.md`参照）
- ✅ アプリケーションが起動していること

---

## 確認手順

### 1. Supabase設定の確認

#### 方法A: Supabase Dashboardから確認（推奨）

1. Supabase Dashboard → Database → Replication → Publications
2. `supabase_realtime` を確認
3. 以下のテーブルにチェックが入っていることを確認:
   - ✅ `training_scores`
   - ✅ `results`
   - ✅ `sessions`

#### 方法B: SQLで確認

Supabase Dashboard → SQL Editor で以下を実行:

```sql
-- 確認スクリプトを実行
-- (scripts/check-realtime-setup.sqlの内容をコピー&ペースト)
```

または、ローカルのSupabase CLIを使用:

```bash
# Supabase CLIがインストールされている場合
supabase db reset --db-url "your-database-url" < scripts/check-realtime-setup.sql
```

**期待される結果**:
```
✅ すべての設定が完了しています！

次のステップ:
1. アプリケーションを起動してください
2. ブラウザのDevToolsコンソールを開いてください
3. スコア監視ページを開いて接続ログを確認してください
```

---

### 2. アプリケーション起動とブラウザ確認

#### Step 1: アプリケーションを起動

```bash
npm run dev
```

#### Step 2: ブラウザでDevToolsを開く

1. Chrome/Edgeの場合: `F12` または `Cmd+Option+I` (Mac)
2. **Console** タブを選択

#### Step 3: スコア監視ページを開く

研修モードまたは大会モードのスコア監視ページにアクセス

**期待されるログ**:

✅ **成功時のログ**:
```
[status/realtime] スコア監視のRealtime購読開始: training-scores-...
[status/realtime] スコア監視チャンネルの状態: SUBSCRIBED
[status/realtime] ✅ スコア監視のRealtime接続成功
```

❌ **失敗時のログ**:
```
[status/realtime] ❌ スコア監視の接続エラー
CHANNEL_ERROR または TIMED_OUT
```

→ 失敗した場合は、`REALTIME_SETUP.md` の設定を再確認してください

---

### 3. リアルタイム更新のテスト

#### テスト1: スコア監視のリアルタイム更新

**目的**: スコアが即座に反映されることを確認

**手順**:

1. **主任検定員のブラウザ**（ブラウザA）:
   - ログイン
   - セッションを作成
   - ゼッケン1番の採点状況確認画面を開く
   - DevToolsコンソールを開いておく

2. **一般検定員のブラウザ**（ブラウザB）:
   - 別のブラウザまたはシークレットウィンドウで開く
   - 一般検定員としてログイン
   - 同じセッションに参加
   - ゼッケン1番のスコアを入力（例: 85点）

3. **検証**:
   - ブラウザAの画面が**3秒待たずに即座に**更新されることを確認
   - ブラウザAのコンソールに以下のログが表示されることを確認:
     ```
     [status/realtime] スコア変更を検知: {eventType: "INSERT"}
     [status/realtime] 新しいスコアを追加: 検定員名 85
     ```

4. **修正要求のテスト**:
   - ブラウザAで「修正」ボタンをクリック
   - ブラウザBのコンソールに以下のログが表示されることを確認:
     ```
     [status/realtime] スコア変更を検知: {eventType: "DELETE"}
     [status/realtime] スコアを削除
     ```
   - ブラウザBが自動的に採点画面に遷移することを確認

**期待される挙動**:
- ✅ スコア反映が0.5秒以内
- ✅ ページリロードなし（画面フラッシュなし）
- ✅ ポーリング待機なし

---

#### テスト2: スコアボードのリアルタイム更新

**目的**: スコアボードが即座に更新されることを確認

**手順**:

1. **観客のブラウザ**（ブラウザA）:
   - スコアボードページを開く: `/scoreboard/[sessionId]`
   - DevToolsコンソールを開いておく
   - 以下のログを確認:
     ```
     [scoreboard] Realtime購読開始: scoreboard-...
     [scoreboard] ✅ Realtime接続成功 - ポーリング不要
     ```

2. **主任検定員のブラウザ**（ブラウザB）:
   - ログイン
   - 新しいスコアを確定

3. **検証**:
   - ブラウザAのスコアボードが**30秒待たずに即座に**更新されることを確認
   - ブラウザAのコンソールに以下のログが表示されることを確認:
     ```
     [scoreboard] スコア変更を検知 - リロード中... INSERT
     ```

**期待される挙動**:
- ✅ スコア反映が即座（30秒待機なし）
- ⚠️ 現在の実装ではページリロードあり（将来の改善で差分更新に置き換え可能）

---

#### テスト3: セッション状態の監視（Realtimeのみ）

**目的**: セッション終了がリアルタイムで検知されることを確認（ポーリングなし）

**手順**:

1. **一般検定員のブラウザ**（ブラウザA）:
   - ログイン
   - セッションに参加
   - スコア監視画面を開く

2. **主任検定員のブラウザ**（ブラウザB）:
   - 「検定を終了する」をクリック

3. **検証**:
   - ブラウザAが**3秒待たずに即座に**終了画面に遷移することを確認
   - ブラウザAのコンソールに以下のログが表示されることを確認:
     ```
     [一般検定員/status/realtime] セッション更新を検知
     [一般検定員/status/realtime] 検定終了を検知（true→false） → 終了画面に遷移
     ```

**期待される挙動**:
- ✅ 即座に遷移（3秒待機なし）
- ✅ ポーリングなし（Realtimeのみ）

---

### 4. パフォーマンス確認

#### ブラウザのNetworkタブで確認

1. DevTools → **Network** タブを開く
2. スコア監視ページを開く
3. 60秒間待機

**Before（ポーリング実装）**:
- 約20リクエスト（3秒×20 = 60秒）
- リクエスト例: `GET /api/score-status/...`

**After（Realtime実装）**:
- 0〜2リクエスト（初回ロードのみ）
- WebSocket接続が1つ（`wss://...supabase.co/realtime/v1/websocket`）

---

## トラブルシューティング

### 問題1: Realtime接続エラー

**症状**:
```
[status/realtime] ❌ スコア監視の接続エラー
CHANNEL_ERROR
```

**原因と対策**:

1. **Realtimeが有効化されていない**
   ```sql
   -- Supabase SQL Editorで確認
   SELECT tablename FROM pg_publication_tables
   WHERE pubname = 'supabase_realtime'
     AND tablename IN ('training_scores', 'results', 'sessions');
   ```
   → 3行表示されない場合、`REALTIME_SETUP.md` Step 1を実行

2. **ネットワーク接続の問題**
   - WebSocketポート（443）がブロックされていないか確認
   - プロキシ/ファイアウォール設定を確認

3. **Supabaseサービスの問題**
   - https://status.supabase.com/ でステータスを確認

---

### 問題2: DELETEイベントで`payload.old`がnull

**症状**:
削除されたスコアの情報が取得できない

**原因**:
`REPLICA IDENTITY`が`DEFAULT`または`NOTHING`に設定されている

**対策**:
```sql
-- Supabase SQL Editorで実行
ALTER TABLE training_scores REPLICA IDENTITY FULL;
ALTER TABLE results REPLICA IDENTITY FULL;
ALTER TABLE sessions REPLICA IDENTITY FULL;
```

---

### 問題3: 更新が反映されない

**症状**:
スコアを入力しても他のユーザーの画面に反映されない

**原因と対策**:

1. **RLSポリシーの問題**
   ```sql
   -- SELECTポリシーを確認
   SELECT tablename, policyname, cmd
   FROM pg_policies
   WHERE tablename = 'training_scores' AND cmd = 'SELECT';
   ```
   → ポリシーが存在しない場合、migration 042を実行

2. **フィルター条件の問題**
   - コンソールログで`filter`条件を確認
   - `event_id`, `athlete_id`, `session_id`が正しいか確認

---

## 成功基準

以下がすべて✅であれば、Realtime移行は成功です:

- [ ] Supabase設定スクリプトで「✅ すべての設定が完了しています！」が表示される
- [ ] ブラウザコンソールで「✅ スコア監視のRealtime接続成功」が表示される
- [ ] スコア入力後、他のユーザーの画面が0.5秒以内に更新される
- [ ] スコアボードが30秒待たずに即座に更新される
- [ ] Networkタブでポーリングリクエストが削減されている（90%削減）

---

## 次のステップ

すべての確認が完了したら:

1. 本番環境にデプロイ
2. 本番環境でも同様の動作確認を実施
3. ユーザーからのフィードバックを収集
4. 必要に応じてスコアボードの差分更新を実装（現在はリロード方式）

---

## 参考

- `REALTIME_SETUP.md` - Supabase設定ガイド
- `scripts/check-realtime-setup.sql` - 設定確認スクリプト
- `scripts/apply-realtime-setup.sql` - 設定適用スクリプト
