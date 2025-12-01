# RLS最適化ガイド

## 📋 目次

1. [最適化の原則](#最適化の原則)
2. [推奨アプローチ](#推奨アプローチ)
3. [実装手順](#実装手順)
4. [避けるべきパターン](#避けるべきパターン)
5. [テスト方法](#テスト方法)
6. [パフォーマンス測定](#パフォーマンス測定)

---

## 🎯 最適化の原則

### 1. **安全第一**
- ✅ データの整合性を保つ
- ✅ 既存の機能を壊さない
- ✅ セキュリティを維持する
- ❌ パフォーマンスのためにセキュリティを犠牲にしない

### 2. **段階的な実装**
- ✅ 1テーブルずつ最適化
- ✅ 各ステップでテスト
- ✅ 問題が発生したらすぐにロールバック
- ❌ 一度に全テーブルを変更しない

### 3. **測定してから最適化**
- ✅ 現在のパフォーマンスを測定
- ✅ ボトルネックを特定
- ✅ 最適化後に再測定
- ❌ 推測で最適化しない

---

## 💡 推奨アプローチ

### アプローチ 1: SECURITY DEFINER 関数（推奨）

**メリット:**
- ✅ 無限再帰を回避
- ✅ auth.uid() の評価を1回に削減
- ✅ 複雑なロジックをカプセル化
- ✅ クエリプランナーが最適化しやすい

**実装例:**

```sql
-- Helper関数を作成
CREATE OR REPLACE FUNCTION get_current_user_id()
RETURNS UUID AS $$
BEGIN
  RETURN auth.uid();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- ポリシーで使用
CREATE POLICY "Users can view own profile"
ON profiles FOR SELECT
USING (id = get_current_user_id());
```

**キーポイント:**
- `SECURITY DEFINER`: RLSをバイパス（無限再帰回避）
- `STABLE`: トランザクション内で結果をキャッシュ（パフォーマンス向上）

---

### アプローチ 2: サブクエリ最適化（慎重に使用）

**メリット:**
- ✅ 関数を作らなくて済む
- ✅ シンプルなケースで有効

**デメリット:**
- ❌ 自己参照テーブルで無限再帰のリスク
- ❌ 複雑なクエリでパフォーマンスが悪化する場合がある

**安全な使用例:**

```sql
-- ✅ 良い例: 他のテーブルを参照
CREATE POLICY "Session creators can view custom events"
ON custom_events FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM sessions
    WHERE sessions.id = custom_events.session_id
    AND sessions.created_by = (SELECT auth.uid())
  )
);

-- ❌ 悪い例: 同じテーブルを参照（無限再帰）
CREATE POLICY "Members can view organization members"
ON organization_members FOR SELECT
USING (
  organization_id IN (
    SELECT organization_id
    FROM organization_members  -- ← 無限ループ！
    WHERE user_id = (SELECT auth.uid())
  )
);
```

---

### アプローチ 3: インデックス最適化（併用推奨）

RLS最適化と並行して実施:

```sql
-- auth.uid() でフィルタリングされるカラムにインデックス
CREATE INDEX idx_sessions_created_by ON sessions(created_by);
CREATE INDEX idx_profiles_id ON profiles(id);
CREATE INDEX idx_organization_members_user_id ON organization_members(user_id);

-- 複合条件用の部分インデックス
CREATE INDEX idx_organization_members_active
ON organization_members(user_id, organization_id)
WHERE removed_at IS NULL;
```

---

## 🔧 実装手順

### ステップ1: 現状分析

```sql
-- Supabase Performance Advisorを確認
-- または pg_stat_statements でスロークエリを特定

-- 現在のRLSポリシーを確認
SELECT tablename, policyname, qual
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename;

-- auth.uid() を使用しているポリシーを特定
SELECT tablename, policyname, qual
FROM pg_policies
WHERE qual LIKE '%auth.uid()%'
ORDER BY tablename;
```

### ステップ2: Helper関数の作成

```sql
-- 基本的なHelper関数
CREATE OR REPLACE FUNCTION get_current_user_id()
RETURNS UUID AS $$
BEGIN
  RETURN auth.uid();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- テーブル固有のHelper関数
CREATE OR REPLACE FUNCTION is_session_creator(session_id_param BIGINT)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM sessions
    WHERE id = session_id_param
    AND created_by = auth.uid()
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- 権限を付与
GRANT EXECUTE ON FUNCTION get_current_user_id() TO authenticated;
GRANT EXECUTE ON FUNCTION is_session_creator(BIGINT) TO authenticated;
```

### ステップ3: 1テーブルずつ最適化

**優先順位:**

1. **高優先度**: 頻繁にアクセスされるテーブル
   - `profiles`
   - `sessions`
   - `results`

2. **中優先度**: 中程度のアクセス
   - `custom_events`
   - `participants`
   - `training_events`

3. **低優先度**: アクセス頻度が低い
   - `invitations`
   - `invitation_uses`

**実装例（profiles テーブル）:**

```sql
-- 1. 既存ポリシーを確認
SELECT policyname, qual FROM pg_policies WHERE tablename = 'profiles';

-- 2. 新しいポリシーを作成
DROP POLICY IF EXISTS "Users can view own profile" ON profiles;
CREATE POLICY "Users can view own profile"
ON profiles FOR SELECT
TO authenticated
USING (id = get_current_user_id());

-- 3. テスト
-- ログインして、プロフィールが表示されるか確認

-- 4. パフォーマンス測定
EXPLAIN ANALYZE SELECT * FROM profiles WHERE id = auth.uid();
EXPLAIN ANALYZE SELECT * FROM profiles WHERE id = get_current_user_id();
```

### ステップ4: テストとロールバック準備

```sql
-- ロールバック用スクリプトを準備
DROP POLICY IF EXISTS "Users can view own profile" ON profiles;
CREATE POLICY "Users can view own profile"
ON profiles FOR SELECT
TO authenticated
USING (id = auth.uid());  -- 元に戻す
```

---

## ⚠️ 避けるべきパターン

### 1. ❌ 同じテーブルの自己参照（無限再帰）

```sql
-- ❌ 絶対にやってはいけない
CREATE POLICY "Members can view organization members"
ON organization_members FOR SELECT
USING (
  organization_id IN (
    SELECT organization_id
    FROM organization_members  -- 無限ループ！
    WHERE user_id = auth.uid()
  )
);
```

**解決策:**

```sql
-- ✅ SECURITY DEFINER 関数を使用
CREATE FUNCTION get_user_organization_ids()
RETURNS SETOF UUID AS $$
BEGIN
  RETURN QUERY
  SELECT organization_id FROM organization_members
  WHERE user_id = auth.uid() AND removed_at IS NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE POLICY "Members can view organization members"
ON organization_members FOR SELECT
USING (organization_id IN (SELECT get_user_organization_ids()));
```

---

### 2. ❌ SECURITY DEFINER なしで複雑なサブクエリ

```sql
-- ❌ パフォーマンスが悪い
CREATE POLICY "Complex policy"
ON results FOR SELECT
USING (
  session_id IN (
    SELECT s.id FROM sessions s
    JOIN session_participants sp ON sp.session_id = s.id
    WHERE sp.user_id = auth.uid()
    OR s.created_by = auth.uid()
  )
);
```

**解決策:**

```sql
-- ✅ Helper関数で簡潔に
CREATE FUNCTION can_view_session_results(session_id_param BIGINT)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM sessions s
    LEFT JOIN session_participants sp ON sp.session_id = s.id
    WHERE s.id = session_id_param
    AND (sp.user_id = auth.uid() OR s.created_by = auth.uid())
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

CREATE POLICY "Users can view results"
ON results FOR SELECT
USING (can_view_session_results(session_id));
```

---

### 3. ❌ 一度に全ポリシーを変更

```sql
-- ❌ 危険: 一度に全テーブルを変更
-- すべてのポリシーを DROP して再作成
-- → 何か問題が起きたら全体が壊れる
```

**解決策:**

```sql
-- ✅ 安全: 1テーブルずつ変更
-- 1. profiles を最適化 → テスト
-- 2. sessions を最適化 → テスト
-- 3. custom_events を最適化 → テスト
-- ...
```

---

### 4. ❌ SECURITY DEFINER で VOLATILE 関数

```sql
-- ❌ パフォーマンスが悪い
CREATE FUNCTION get_current_user_id()
RETURNS UUID AS $$
BEGIN
  RETURN auth.uid();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;  -- VOLATILE (デフォルト)
```

**解決策:**

```sql
-- ✅ STABLE または IMMUTABLE を指定
CREATE FUNCTION get_current_user_id()
RETURNS UUID AS $$
BEGIN
  RETURN auth.uid();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;  -- キャッシュされる
```

---

## 🧪 テスト方法

### 1. 機能テスト

```typescript
// 各機能が正常に動作するか確認

// ✅ ログイン
// ✅ プロフィール表示
// ✅ セッション一覧表示
// ✅ セッション作成
// ✅ 採点機能
// ✅ スコアボード表示
// ✅ 組織管理
```

### 2. 権限テスト

```sql
-- 自分のデータは見えるか
SELECT * FROM sessions WHERE created_by = auth.uid();

-- 他人のデータは見えないか
-- (別のユーザーでログインして確認)
SELECT * FROM sessions WHERE created_by != auth.uid();
-- → 0件であるべき
```

### 3. エラーチェック

```bash
# アプリケーションログを確認
# 以下のエラーがないか確認:
# - infinite recursion detected
# - permission denied
# - function does not exist
```

---

## 📊 パフォーマンス測定

### 1. クエリ実行計画の比較

```sql
-- 最適化前
EXPLAIN ANALYZE
SELECT * FROM sessions
WHERE created_by = auth.uid();

-- 最適化後
EXPLAIN ANALYZE
SELECT * FROM sessions
WHERE created_by = get_current_user_id();

-- チェックポイント:
-- - "Initplan" が消えているか確認
-- - Execution Time が短縮されているか確認
```

### 2. Supabase Performance Advisor

```
Supabase Dashboard
→ Database
→ Reports
→ Performance Advisor

確認項目:
- RLS Initplan warnings が減っているか
- 実行時間の長いクエリが改善されているか
```

### 3. pg_stat_statements

```sql
-- スロークエリを確認
SELECT
  query,
  calls,
  mean_exec_time,
  max_exec_time
FROM pg_stat_statements
WHERE query LIKE '%sessions%'
ORDER BY mean_exec_time DESC
LIMIT 10;
```

### 4. 実アプリケーションでの測定

```typescript
// ページ読み込み時間を測定
const start = performance.now();
await supabase.from('sessions').select('*');
const end = performance.now();
console.log(`Query time: ${end - start}ms`);
```

---

## 📈 期待される改善効果

### 最適化前 vs 最適化後

| 項目 | 最適化前 | 最適化後 | 改善率 |
|------|----------|----------|--------|
| スコアボード読み込み | 2-5秒 | 0.5-1秒 | **60-80%削減** |
| セッション一覧 | 1-3秒 | 0.3-0.8秒 | **70-75%削減** |
| 組織メンバー一覧 | 1-2秒 | 0.2-0.5秒 | **75-80%削減** |
| CPU使用率 | 100% | 60-80% | **20-40%削減** |

---

## 🎓 まとめ

### ✅ やるべきこと

1. **SECURITY DEFINER 関数を使用**
   - 無限再帰を回避
   - パフォーマンス向上
   - コードの可読性向上

2. **STABLE 修飾子を付ける**
   - トランザクション内でキャッシュ
   - 不要な再実行を防ぐ

3. **段階的に実装**
   - 1テーブルずつ
   - 各ステップでテスト
   - ロールバック準備

4. **パフォーマンスを測定**
   - 最適化前後で比較
   - 実データで確認

### ❌ やってはいけないこと

1. **自己参照ポリシー**
   - 無限再帰のリスク
   - SECURITY DEFINER 関数で回避

2. **一度に全変更**
   - リスクが高すぎる
   - トラブル時に原因特定が困難

3. **テストなしで本番適用**
   - 必ず開発環境でテスト
   - 段階的にロールアウト

4. **既存のマイグレーションを無視**
   - 過去の修正を確認
   - 同じ問題を繰り返さない

---

## 🚀 次のステップ

現在、`migrations/005_safe_rls_optimization.sql` に安全な最適化スクリプトが用意されています。

**実行手順:**

1. **開発環境でテスト**（推奨）
2. **段階的に適用**（テーブルごとにコメントアウトして実行）
3. **各ステップで機能確認**
4. **パフォーマンス測定**
5. **本番環境に適用**

問題が発生した場合は、すぐにロールバックできるよう準備しておいてください。
