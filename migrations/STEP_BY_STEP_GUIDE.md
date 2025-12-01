# 段階的最適化ガイド

## 📋 概要

RLS最適化を**安全に段階的に**適用するための詳細ガイドです。

---

## 🎯 段階的適用のメリット

### ✅ リスクを最小化
- 1ステップずつテストできる
- 問題が起きても影響範囲が小さい
- どのステップで問題が起きたか特定しやすい

### ✅ ロールバックが簡単
- 問題のあるステップだけ戻せる
- 全体を巻き戻す必要がない

### ✅ 学習しながら進められる
- 各ステップの効果を確認できる
- パフォーマンス改善を実感できる

---

## 📝 実行手順

### ステップ0: 準備

#### 1. バックアップ
Supabaseダッシュボード → Settings → Backups → Create backup

#### 2. 現在の状態を記録

```sql
-- 現在のポリシーを確認
SELECT tablename, policyname, qual
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;

-- 結果をコピーして保存しておく
```

#### 3. パフォーマンスのベースライン測定

```sql
-- ページ読み込み時間を記録
-- - ダッシュボード: ___秒
-- - スコアボード: ___秒
-- - セッション詳細: ___秒
```

---

### ステップ1: Helper関数の作成 ⭐ **最初に実行**

**ファイル:** `005_step1_helper_functions.sql`

**内容:**
- `get_current_user_id()` - auth.uid()のキャッシュ版
- `is_session_creator()` - セッション作成者チェック
- `is_session_participant()` - セッション参加者チェック
- `get_user_organization_ids()` - ユーザーの組織ID取得
- `is_organization_admin()` - 組織管理者チェック

**リスク:** 🟢 低（関数を作るだけ、既存の動作に影響なし）

**実行方法:**

1. Supabaseダッシュボードにログイン
2. SQL Editor を開く
3. `005_step1_helper_functions.sql` の内容をコピー＆ペースト
4. **Run** をクリック

**確認:**

```sql
-- 関数が作成されたか確認
SELECT proname, prosecdef, provolatile
FROM pg_proc
WHERE proname IN (
  'get_current_user_id',
  'is_session_creator',
  'is_session_participant',
  'get_user_organization_ids',
  'is_organization_admin'
);

-- 5つの関数が表示されればOK
```

**期待される出力:**
```
✓ Step 1 完了: Helper関数が作成されました
次のステップ: 005_step2_profiles.sql を実行してください
```

---

### ステップ2: PROFILES テーブルの最適化

**ファイル:** `005_step2_profiles.sql`

**内容:**
- プロフィール表示の最適化
- `auth.uid()` → `get_current_user_id()`

**リスク:** 🟢 低（シンプルなテーブル、自己参照なし）

**期待効果:** プロフィール表示が高速化

**実行方法:**

1. SQL Editor で `005_step2_profiles.sql` を実行
2. 出力メッセージを確認

**テスト項目:**

```
✅ アプリにログインできるか
✅ プロフィールページが表示されるか
✅ プロフィールを編集できるか
✅ エラーログに問題がないか
```

**パフォーマンス測定:**

```sql
-- 実行計画を確認
EXPLAIN ANALYZE
SELECT * FROM profiles WHERE id = auth.uid();

EXPLAIN ANALYZE
SELECT * FROM profiles WHERE id = get_current_user_id();

-- "InitPlan" の数を比較
-- 最適化後は1回だけになっているはず
```

**問題が発生した場合:**

```sql
-- ロールバック（元に戻す）
DROP POLICY IF EXISTS "Users can view own profile" ON profiles;
CREATE POLICY "Users can view own profile"
ON profiles FOR SELECT
TO authenticated
USING (id = auth.uid());

DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
CREATE POLICY "Users can update own profile"
ON profiles FOR UPDATE
TO authenticated
USING (id = auth.uid());

DROP POLICY IF EXISTS "Users can insert own profile" ON profiles;
CREATE POLICY "Users can insert own profile"
ON profiles FOR INSERT
TO authenticated
WITH CHECK (id = auth.uid());
```

---

### ステップ3: SESSIONS テーブルの最適化

**ファイル:** `005_step3_sessions.sql`

**内容:**
- セッション一覧・詳細の最適化
- created_by, chief_judge_id, organization_id のチェックを最適化

**リスク:** 🟡 中（重要なテーブル、組織との関連あり）

**期待効果:** セッション一覧が60-70%高速化

**実行方法:**

1. SQL Editor で `005_step3_sessions.sql` を実行
2. 出力メッセージを確認

**テスト項目:**

```
✅ ダッシュボードでセッション一覧が表示されるか
✅ 新しいセッションを作成できるか
✅ セッション詳細ページが表示されるか
✅ 自分が作成したセッションのみ表示されるか
✅ 組織のセッションが表示されるか（組織メンバーの場合）
✅ 他人のセッションは見えないか
```

**パフォーマンス測定:**

```typescript
// アプリケーション側で測定
const start = performance.now();
const { data } = await supabase.from('sessions').select('*');
const end = performance.now();
console.log(`Sessions query: ${end - start}ms`);

// 最適化前: 500-1000ms
// 最適化後: 150-300ms を期待
```

**問題が発生した場合:**

ステップ2は成功しているので、ステップ3だけロールバック:

```sql
DROP POLICY IF EXISTS "Users can view own sessions" ON sessions;
CREATE POLICY "Users can view own sessions"
ON sessions FOR SELECT
TO authenticated
USING (created_by = auth.uid());

-- (他のポリシーも同様に元に戻す)
```

---

### ステップ4: CUSTOM_EVENTS + PARTICIPANTS テーブルの最適化

**ファイル:** `005_step4_custom_events.sql`

**内容:**
- 大会モードの種目設定・参加者管理を最適化
- `is_session_creator()` / `is_session_participant()` を使用

**リスク:** 🟡 中（大会モードで使用）

**期待効果:** スコアボード、種目設定が高速化

**実行方法:**

1. SQL Editor で `005_step4_custom_events.sql` を実行

**テスト項目:**

```
✅ 大会モードでセッションを作成できるか
✅ カスタム種目を追加できるか
✅ 種目を編集・削除できるか
✅ 参加者を登録できるか
✅ スコアボードが表示されるか
✅ スコアボードに正しいデータが表示されるか
```

**重要:**
大会モードを使用していない場合は、このステップをスキップしても構いません。

---

### ステップ5: TRAINING_EVENTS + TRAINING_SESSIONS テーブルの最適化

**ファイル:** `005_step5_training.sql`

**内容:**
- トレーニングモードを最適化

**リスク:** 🟡 中（トレーニングモードで使用）

**期待効果:** トレーニングモードが高速化

**実行方法:**

1. SQL Editor で `005_step5_training.sql` を実行

**テスト項目:**

```
✅ トレーニングモードでセッションを作成できるか
✅ トレーニング種目を追加できるか
✅ トレーニングセッションが表示されるか
```

**重要:**
トレーニングモードを使用していない場合は、このステップをスキップしても構いません。

---

### ステップ6: TRAINING_SCORES テーブルの最適化

**ファイル:** `005_step6_training_scores.sql`

**内容:**
- トレーニングスコア更新を最適化（UPDATEポリシーのみ）

**リスク:** 🟢 低（UPDATE ポリシーのみ）

**期待効果:** トレーニングスコア編集が高速化

**実行方法:**

1. SQL Editor で `005_step6_training_scores.sql` を実行

**テスト項目:**

```
✅ トレーニングモードで採点できるか
✅ 採点結果を編集できるか
```

---

### ステップ7: 最終確認

すべてのステップが完了したら、総合的にテストします。

**機能テスト:**

```
✅ ログイン・ログアウト
✅ プロフィール表示・編集
✅ セッション作成・一覧・詳細
✅ 大会モード（種目設定、参加者登録、採点、スコアボード）
✅ トレーニングモード（種目設定、採点）
✅ 組織機能（メンバー一覧、セッション共有）
✅ ゲストアクセス
```

**パフォーマンステスト:**

```sql
-- Supabase Performance Advisor を再確認
-- RLS Initplan warnings が減っているか確認
```

**エラーチェック:**

```bash
# アプリケーションログ
# ブラウザのコンソール
# Supabaseのログ

# 以下のエラーがないか確認:
# - infinite recursion detected
# - permission denied
# - function does not exist
```

---

## 🔄 ロールバック方法

### 全体をロールバック

**ファイル:** `005_rollback_all.sql`

すべての最適化を一度に元に戻します。

```sql
-- 005_rollback_all.sql を実行
```

### 特定のステップだけロールバック

各ステップのロールバック用SQLを実行します（上記の各ステップに記載）。

---

## 📊 各ステップの所要時間

| ステップ | 実行時間 | テスト時間 | 合計 |
|---------|----------|------------|------|
| Step 1: Helper関数 | 1分 | 1分 | 2分 |
| Step 2: Profiles | 1分 | 3分 | 4分 |
| Step 3: Sessions | 1分 | 5分 | 6分 |
| Step 4: Custom Events | 1分 | 5分 | 6分 |
| Step 5: Training | 1分 | 3分 | 4分 |
| Step 6: Training Scores | 1分 | 3分 | 4分 |
| Step 7: 最終確認 | - | 10分 | 10分 |
| **合計** | **6分** | **30分** | **36分** |

**推奨:** 1日で全部やるのではなく、数日に分けて実施することをお勧めします。

---

## 💡 よくある質問

### Q1: すべてのステップを実行する必要がありますか？

**A:** いいえ。使用していない機能のステップはスキップできます。

- **必須:** Step 1（Helper関数）, Step 2（Profiles）, Step 3（Sessions）
- **オプション:** Step 4（大会モード使用時）, Step 5-6（トレーニングモード使用時）

### Q2: 途中で問題が起きたらどうすればいいですか？

**A:** そのステップをロールバックして、前のステップまで戻ります。

例: Step 3 で問題発生
→ Step 3 をロールバック
→ Step 2 までは最適化済み
→ Step 3 の問題を調査・修正後に再実行

### Q3: 本番環境で実行しても大丈夫ですか？

**A:** 段階的に実行すれば比較的安全ですが、可能なら開発環境で先にテストすることを推奨します。

### Q4: 最適化後に元に戻せますか？

**A:** はい、`005_rollback_all.sql` で元に戻せます。Helper関数は残りますが、使用されていないので影響ありません。

### Q5: どのステップが一番効果がありますか？

**A:** Step 3（Sessions）が最も効果が大きいです。次に Step 4（Custom Events）です。

---

## 🎓 まとめ

### 段階的適用の流れ

```
Step 1: Helper関数作成 ✅
   ↓ テスト
Step 2: Profiles最適化 ✅
   ↓ テスト
Step 3: Sessions最適化 ✅
   ↓ テスト
Step 4: Custom Events最適化 ✅
   ↓ テスト
Step 5: Training最適化 ✅
   ↓ テスト
Step 6: Training Scores最適化 ✅
   ↓ 最終確認
完了 🎉
```

### 各ステップで確認すること

1. ✅ SQLが正常に実行されたか
2. ✅ エラーメッセージが出ていないか
3. ✅ 機能が正常に動作するか
4. ✅ パフォーマンスが改善したか

### 問題が起きたら

1. 🔄 そのステップをロールバック
2. 📝 エラーログを確認
3. 🔍 原因を調査
4. 💬 必要に応じて相談

---

**準備はできましたか？** Step 1 から始めましょう！
