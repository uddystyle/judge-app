# データベースパフォーマンス最適化マイグレーション

このディレクトリには、Supabase Performance Advisorで特定されたパフォーマンス問題を修正するためのSQLマイグレーションスクリプトが含まれています。

## 📋 概要

### 特定された問題

1. **🔴 RLS Initplan問題（72件）** - 最優先
   - `auth.uid()`などの関数が行ごとに再評価される
   - 大量のデータを扱う場合、クエリパフォーマンスが指数関数的に悪化
   - 影響テーブル: sessions, profiles, session_participants, organization_members, training_scores, training_sessions, training_events, custom_events, results, participants

2. **🟡 重複インデックス（9件）** - 中優先
   - 同一のインデックスが複数存在
   - ストレージの無駄遣い
   - 書き込み操作の速度低下
   - 影響テーブル: contact_submissions(3), organization_members(1), participants(1), sessions(2), training_events(1), training_scores(1)

## 🚀 マイグレーション手順

### 推奨適用順序

1. **まず開発環境でテスト**
2. **001_remove_duplicate_indexes.sql** を適用（低リスク）
3. **002_fix_rls_initplan.sql** を適用（要注意）
4. **本番環境に適用**

### ステップ1: 重複インデックスの削除（低リスク）

```bash
# Supabase ダッシュボード → SQL Editor で実行
# または psql コマンドラインで実行
```

1. Supabaseダッシュボードにログイン
2. プロジェクトを選択
3. **SQL Editor** に移動
4. `migrations/001_remove_duplicate_indexes.sql` の内容をコピー&ペースト
5. **Run** をクリック

**期待される結果:**
- ✅ 9つの重複インデックスが削除される
- ✅ ストレージ使用量が減少
- ✅ INSERT/UPDATE/DELETE操作が高速化
- ⚠️ SELECT操作のパフォーマンスは変わらない（重複インデックスは削除しても問題なし）

**検証方法:**
```sql
-- 各テーブルのインデックスを確認
SELECT tablename, indexname, indexdef
FROM pg_indexes
WHERE tablename IN ('contact_submissions', 'organization_members', 'participants', 'sessions', 'training_events', 'training_scores')
ORDER BY tablename, indexname;
```

### ステップ2: RLS Initplanの最適化（要注意）

**⚠️ 重要: この変更は認証ロジックに影響します。本番適用前に必ず開発環境でテストしてください。**

1. `migrations/002_fix_rls_initplan.sql` を開く
2. **ポリシー名が実際のデータベースと一致しているか確認**
3. 必要に応じてポリシー名や条件を調整
4. 開発環境で実行してテスト
5. 本番環境に適用

**期待される結果:**
- ✅ `auth.uid()` が `(SELECT auth.uid())` に変更される
- ✅ クエリパフォーマンスが大幅に向上（特に大量データ処理時）
- ✅ スコアボード、セッション詳細などの読み込みが高速化

**検証方法:**
```sql
-- ポリシーの確認
SELECT schemaname, tablename, policyname, permissive, roles, cmd
FROM pg_policies
WHERE tablename IN ('sessions', 'profiles', 'session_participants')
ORDER BY tablename, policyname;

-- パフォーマンステスト（実行計画の比較）
EXPLAIN ANALYZE
SELECT * FROM sessions
WHERE created_by = (SELECT auth.uid());
```

## 🧪 テスト計画

### 機能テスト（必須）

マイグレーション適用後、以下の機能が正常に動作することを確認してください。

#### 1. 認証・認可
- [ ] ユーザーログイン
- [ ] プロフィール表示・編集
- [ ] 自分のセッションのみ表示される
- [ ] 他人のセッションは表示されない

#### 2. セッション管理
- [ ] セッション作成
- [ ] セッション詳細表示
- [ ] セッション編集
- [ ] セッション削除
- [ ] ゲストアクセス

#### 3. 採点機能
- [ ] カスタム種目の採点
- [ ] トレーニング採点
- [ ] 複数検定員モード
- [ ] スコア表示

#### 4. スコアボード
- [ ] 総合ランキング表示
- [ ] 種目別ランキング表示
- [ ] リアルタイム更新
- [ ] ゲストアクセス（認証不要）

#### 5. 組織機能
- [ ] 組織メンバー一覧表示
- [ ] 組織メンバー追加・削除（管理者のみ）
- [ ] 自分の組織メンバーシップのみ表示

### パフォーマンステスト

#### マイグレーション前後の比較

```sql
-- 1. スコアボード読み込み時間
EXPLAIN ANALYZE
SELECT s.id, s.name, s.is_tournament_mode,
       ce.id, ce.discipline, ce.level, ce.event_name,
       r.bib, r.score
FROM sessions s
LEFT JOIN custom_events ce ON ce.session_id = s.id
LEFT JOIN results r ON r.session_id = s.id
WHERE s.id = '[SESSION_ID]';

-- 2. セッション一覧取得時間
EXPLAIN ANALYZE
SELECT * FROM sessions
WHERE created_by = (SELECT auth.uid())
ORDER BY created_at DESC;

-- 3. 組織メンバー一覧取得時間
EXPLAIN ANALYZE
SELECT * FROM organization_members
WHERE user_id = (SELECT auth.uid())
AND removed_at IS NULL;
```

## 📊 期待される改善効果

### 重複インデックス削除後
- **ストレージ削減**: 約5-10%削減（テーブルサイズに依存）
- **書き込み速度**: 5-15%向上
- **インデックスメンテナンス**: 高速化

### RLS Initplan最適化後
- **読み取り速度**: 30-70%向上（データ量が多いほど効果大）
- **スコアボード読み込み**: 2-5秒 → 0.5-1秒
- **セッション一覧表示**: 1-3秒 → 0.3-0.8秒
- **CPU使用率**: 20-40%削減

## 🔄 ロールバック手順

### 重複インデックス削除のロールバック

削除したインデックスを再作成する場合:

```sql
-- 実行前に pg_indexes から元の定義を取得しておく
CREATE INDEX idx_contact_submissions_email ON contact_submissions(email);
CREATE INDEX idx_organization_members_org_id ON organization_members(organization_id);
-- ... 他のインデックスも同様に
```

### RLS Initplan最適化のロールバック

```sql
-- 元のポリシーに戻す
DROP POLICY IF EXISTS "Users can view own profile" ON profiles;
CREATE POLICY "Users can view own profile"
ON profiles FOR SELECT
TO authenticated
USING (id = auth.uid());  -- (SELECT auth.uid()) を auth.uid() に戻す
```

## 📝 注意事項

1. **マイグレーション実行前にバックアップを取る**
   - Supabaseダッシュボード → Settings → Backups

2. **ポリシー名の確認**
   - `002_fix_rls_initplan.sql` のポリシー名は推測に基づいています
   - 実際のポリシー名と異なる場合は調整が必要

3. **段階的適用**
   - テーブルごとに段階的に適用することも可能
   - 問題が発生した場合、すぐにロールバック可能

4. **パフォーマンスモニタリング**
   - マイグレーション後、pg_stat_statementsで効果を測定
   - Supabaseダッシュボード → Database → Reports で監視

5. **ダウンタイム**
   - インデックス削除: ほぼ瞬時（ダウンタイムなし）
   - RLS更新: 数秒程度（影響最小限）

## 🔍 トラブルシューティング

### エラー: "policy does not exist"

**原因**: ポリシー名が実際のデータベースと異なる

**対処法**:
```sql
-- 現在のポリシーを確認
SELECT policyname FROM pg_policies WHERE tablename = 'sessions';

-- スクリプトのポリシー名を実際の名前に修正
```

### エラー: "permission denied"

**原因**: 不十分な権限

**対処法**:
- Supabaseダッシュボードから実行（自動的に適切な権限で実行される）
- または `postgres` ロールで実行

### パフォーマンスが改善しない

**確認事項**:
1. `auth.uid()` が `(SELECT auth.uid())` に正しく変更されているか確認
2. pg_stat_statementsでクエリ実行計画を確認
3. インデックスが適切に使用されているか確認

## 📚 参考資料

- [Supabase Row Level Security](https://supabase.com/docs/guides/auth/row-level-security)
- [PostgreSQL Performance Optimization](https://www.postgresql.org/docs/current/performance-tips.html)
- [pg_stat_statements Documentation](https://www.postgresql.org/docs/current/pgstatstatements.html)

## 💬 サポート

問題が発生した場合:
1. このREADMEのトラブルシューティングセクションを確認
2. Supabaseダッシュボードのログを確認
3. 必要に応じてロールバックを実行
