# 本番用Supabaseセットアップガイド

このガイドでは、本番環境用の新しいSupabaseプロジェクトをセットアップする手順を説明します。

## 目次

1. [新しいSupabaseプロジェクトの作成](#新しいsupabaseプロジェクトの作成)
2. [データベーススキーマの設定](#データベーススキーマの設定)
3. [Vercel環境変数の更新](#vercel環境変数の更新)
4. [動作確認](#動作確認)

---

## 新しいSupabaseプロジェクトの作成

### 1. プロジェクト作成

1. [Supabase Dashboard](https://supabase.com/dashboard)にログイン
2. **New Project** をクリック
3. 以下の情報を入力:
   - **Name**: `tento-production`
   - **Database Password**: 強力なパスワードを設定（必ず保存しておく）
   - **Region**: `Northeast Asia (Tokyo)`
   - **Pricing Plan**: 適切なプランを選択（Pro推奨）
4. **Create new project** をクリック
5. プロジェクトの準備が完了するまで数分待つ

### 2. APIキーとURLの取得

プロジェクトが作成されたら:

1. 左サイドバーの **Settings** → **API** に移動
2. 以下の情報をコピーして保存:
   - **Project URL**: `https://xxxxxxxxx.supabase.co`
   - **anon public**: `eyJhbG...` で始まる文字列
   - **service_role**: `eyJhbG...` で始まる文字列（⚠️ 絶対に公開しない）

---

## データベーススキーマの設定

### 1. メインスキーマの実行

1. Supabaseダッシュボードで **SQL Editor** を開く
2. **New query** をクリック
3. 以下のファイルの内容をコピー&ペースト:
   ```
   database/migrations/009_phase1_rebuild_database_structure.sql
   ```
4. **Run** をクリックして実行
5. エラーがないことを確認

### 2. 追加マイグレーションの実行

以下のマイグレーションを順番に実行:

#### Step 1: RLSポリシーの修正
```
database/migrations/015_complete_rls_reset.sql
```

#### Step 2: 組織RLSの修正
```
database/migrations/017_fix_organizations_rls.sql
```

#### Step 3: 組織ベースRLS
```
database/migrations/018_organization_based_rls.sql
```

#### Step 4: 組織ポリシーの修正
```
database/migrations/020_fix_organizations_policies.sql
```

#### Step 5: プロファイルRLSの修正
```
database/migrations/021_fix_profiles_rls.sql
```

各ファイルを:
1. **SQL Editor** で新しいクエリを開く
2. ファイル内容をコピー&ペースト
3. **Run** をクリック
4. エラーがないことを確認

### 3. データベース設定の確認

SQL Editorで以下を実行してテーブルが正しく作成されたか確認:

```sql
-- すべてのテーブルを確認
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_name;
```

以下のテーブルが存在することを確認:
- `profiles`
- `organizations`
- `organization_members`
- `sessions`
- `session_participants`
- `candidates`
- `scores`
- `training_scores`
- `invitations`
- `subscriptions`

---

## Vercel環境変数の更新

### 1. 開発環境の保護

まず、開発環境のSupabase情報を確保:

#### ローカルの `.env` ファイル

現在の開発用の設定を保持:

```env
# Supabase - 開発環境
PUBLIC_SUPABASE_URL="https://kbxlukbvhlxponcentyp.supabase.co"
PUBLIC_SUPABASE_ANON_KEY="sb_publishable_od8Ghi9eDXy1_g2CsXPLNw_0i4NIO4S"
SUPABASE_URL="https://kbxlukbvhlxponcentyp.supabase.co"
SUPABASE_SERVICE_ROLE_KEY="eyJhbG...（開発用のService Role Key）"

# Stripe - 開発環境（テストモード）
PUBLIC_STRIPE_PUBLISHABLE_KEY="pk_test_wg7gSuSKzTYjcRWrVpxpXs9p"
STRIPE_SECRET_KEY="sk_test_7YFFNxs4VYDEpWB4SoF2uh3t"
STRIPE_WEBHOOK_SECRET="whsec_7b1dfe..."
```

### 2. Vercel環境変数の設定

[Vercel Dashboard](https://vercel.com/dashboard) にアクセス:

1. プロジェクトを選択
2. **Settings** → **Environment Variables** に移動
3. **Production環境のみ**以下の変数を更新/追加:

#### Supabase環境変数（Production）

| Variable Name | Value | Environment |
|--------------|-------|-------------|
| `PUBLIC_SUPABASE_URL` | 本番用のProject URL | Production |
| `PUBLIC_SUPABASE_ANON_KEY` | 本番用のanon public key | Production |
| `SUPABASE_URL` | 本番用のProject URL | Production |
| `SUPABASE_SERVICE_ROLE_KEY` | 本番用のservice_role key | Production |

#### Stripe環境変数（本番モードに移行する場合）

⚠️ **注意**: Stripe本番環境への移行は別途 `STRIPE_PRODUCTION_MIGRATION.md` を参照

本番Stripeに移行する場合のみ、以下も更新:

| Variable Name | Value | Environment |
|--------------|-------|-------------|
| `PUBLIC_STRIPE_PUBLISHABLE_KEY` | `pk_live_xxxxx` | Production |
| `STRIPE_SECRET_KEY` | `sk_live_xxxxx` | Production |
| `STRIPE_WEBHOOK_SECRET` | 本番用webhook secret | Production |
| `STRIPE_PRICE_BASIC_MONTH` | 本番用Price ID | Production |
| `STRIPE_PRICE_BASIC_YEAR` | 本番用Price ID | Production |
| `STRIPE_PRICE_STANDARD_MONTH` | 本番用Price ID | Production |
| `STRIPE_PRICE_STANDARD_YEAR` | 本番用Price ID | Production |
| `STRIPE_PRICE_PREMIUM_MONTH` | 本番用Price ID | Production |
| `STRIPE_PRICE_PREMIUM_YEAR` | 本番用Price ID | Production |

### 3. 環境変数の確認

設定後、以下を確認:

- ✅ **Development**: 開発用Supabase + Stripeテストモード
- ✅ **Production**: 本番用Supabase + Stripe本番モード（移行後）

### 4. Vercelの再デプロイ

環境変数を更新したら、必ず再デプロイ:

1. Vercelダッシュボードの **Deployments** タブに移動
2. 最新のデプロイメントの **︙** メニューをクリック
3. **Redeploy** を選択
4. デプロイが完了するまで待つ

または、ローカルからプッシュ:

```bash
git commit --allow-empty -m "Redeploy for production Supabase environment"
git push
```

---

## 動作確認

### 1. 本番環境での新規ユーザー登録

1. `https://tentoapp.com` にアクセス
2. 新規アカウントを作成
3. メール認証を完了
4. ダッシュボードにアクセスできることを確認

### 2. データベース確認

Supabase（本番）のダッシュボードで:

1. **Table Editor** を開く
2. `profiles` テーブルに新しいユーザーが追加されたことを確認
3. 他のテーブルも正常に動作することを確認

### 3. 組織作成テスト

1. 本番環境で組織を作成（フリープラン）
2. `organizations` テーブルにレコードが追加されることを確認
3. `organization_members` テーブルに管理者として追加されることを確認

### 4. セッション作成テスト

1. セッションを作成
2. `sessions` テーブルにレコードが追加されることを確認
3. リアルタイム更新が動作することを確認

---

## トラブルシューティング

### エラー: "relation does not exist"

**原因**: テーブルが作成されていない

**解決方法**:
1. SQL Editorでテーブル一覧を確認
2. マイグレーションファイルを再実行

### エラー: "RLS policy violation"

**原因**: RLSポリシーが正しく設定されていない

**解決方法**:
1. RLS関連のマイグレーションを再実行
2. 以下のSQLで一時的にRLSを無効化して確認:
```sql
ALTER TABLE table_name DISABLE ROW LEVEL SECURITY;
```

### エラー: "JWT expired" または "Invalid JWT"

**原因**: 環境変数のキーが間違っている

**解決方法**:
1. Vercelの環境変数を確認
2. `PUBLIC_SUPABASE_ANON_KEY` と `SUPABASE_SERVICE_ROLE_KEY` が本番用プロジェクトのものか確認
3. 再デプロイ

### 開発環境でテストデータが見える

**原因**: ローカルの `.env` が本番用に更新されている

**解決方法**:
1. `.env` ファイルを開発用の設定に戻す
2. 開発サーバーを再起動: `npm run dev`

---

## 環境の使い分け

### 開発環境（ローカル）
- **Supabase**: 開発用プロジェクト
- **Stripe**: テストモード
- **目的**: 新機能の開発とテスト

### 本番環境（Vercel Production）
- **Supabase**: 本番用プロジェクト
- **Stripe**: 本番モード
- **目的**: 実際のユーザーが使用

---

## まとめ

このガイドに従って設定を完了すると:

- ✅ 本番環境に新しいクリーンなデータベース
- ✅ 開発環境とのデータ分離
- ✅ テストデータの混在なし
- ✅ セキュアな環境変数管理

何か問題が発生した場合は、トラブルシューティングセクションを参照してください。
