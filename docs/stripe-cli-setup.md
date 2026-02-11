# Stripe CLI セットアップガイド

Stripe CLIは、ローカル開発環境でWebhookイベントをテストするためのツールです。

## 前提条件

- Stripe アカウントにログイン済み
- テストモードに切り替え済み

---

## 1. Stripe CLI のインストール

### macOS (Homebrew)

```bash
brew install stripe/stripe-cli/stripe
```

### Windows

[Stripe CLI公式ダウンロードページ](https://stripe.com/docs/stripe-cli#install) からインストーラーをダウンロード

### Linux

```bash
# Debian/Ubuntu
wget https://github.com/stripe/stripe-cli/releases/latest/download/stripe_linux_x86_64.tar.gz
tar -xvf stripe_linux_x86_64.tar.gz
sudo mv stripe /usr/local/bin/
```

---

## 2. Stripe CLI でログイン

ターミナルで以下のコマンドを実行：

```bash
stripe login
```

ブラウザが開き、Stripeダッシュボードにリダイレクトされます。
「Allow access」をクリックして認証を完了してください。

---

## 3. Webhook の転送を開始

開発サーバーが起動している状態で、以下のコマンドを実行：

```bash
stripe listen --forward-to localhost:5173/api/stripe/webhook
```

**重要**: ポート番号は開発サーバーのポートに合わせてください。
- SvelteKit のデフォルトは `5173`
- 別のポートで起動している場合は、そのポート番号を指定してください

コマンドを実行すると、以下のような出力が表示されます：

```
> Ready! Your webhook signing secret is whsec_xxxxxxxxxxxxxxxxxxxxx (^C to quit)
```

この `whsec_xxxxxxxxxxxxxxxxxxxxx` が **Webhook Signing Secret** です。

---

## 4. Webhook Signing Secret を .env に追加

上記のコマンドで表示された `whsec_xxxxxxxxxxxxxxxxxxxxx` をコピーし、
`.env` ファイルの `STRIPE_WEBHOOK_SECRET` に設定してください：

```env
STRIPE_WEBHOOK_SECRET=whsec_xxxxxxxxxxxxxxxxxxxxx
```

---

## 5. 開発サーバーを再起動

`.env` ファイルを変更したので、開発サーバーを再起動してください：

```bash
# 開発サーバーを停止 (Ctrl+C)
# 再度起動
npm run dev
```

---

## 6. Webhook のテスト

別のターミナルウィンドウを開き、以下のコマンドでテストイベントを送信：

```bash
# Checkout完了イベントをテスト
stripe trigger checkout.session.completed

# サブスクリプション作成イベントをテスト
stripe trigger customer.subscription.created
```

開発サーバーのログに、Webhookイベントが受信されたことが表示されるはずです：

```
[Webhook] イベント受信: checkout.session.completed ID: evt_xxxxx
```

---

## 7. 日常的な開発フロー

開発を行う際は、以下の2つのターミナルを起動しておきます：

**ターミナル1: 開発サーバー**
```bash
npm run dev
```

**ターミナル2: Stripe CLI**
```bash
stripe listen --forward-to localhost:5173/api/stripe/webhook
```

これにより、ローカル開発環境でStripeのWebhookイベントを受信できます。

---

## トラブルシューティング

### "Invalid API Key" エラーが出る

```bash
stripe login
```

で再度ログインしてください。

### Webhook が届かない

1. 開発サーバーが起動していることを確認
2. ポート番号が正しいことを確認（`localhost:5173` など）
3. `stripe listen` コマンドが実行中であることを確認

### Webhook Signing Secret が変わる

`stripe listen` コマンドを実行するたびに、新しい Webhook Signing Secret が生成されます。
`.env` ファイルの `STRIPE_WEBHOOK_SECRET` を更新し、開発サーバーを再起動してください。

---

## 本番環境への移行

本番環境では、Stripe CLI は使用しません。
代わりに、Stripeダッシュボードで Webhook エンドポイントを設定します：

1. Stripe ダッシュボード → **開発者** → **Webhook**
2. **エンドポイントを追加** をクリック
3. エンドポイント URL を入力: `https://your-domain.com/api/stripe/webhook`
4. リッスンするイベントを選択:
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_succeeded`
   - `invoice.payment_failed`
5. **Signing Secret** をコピーし、Vercelの環境変数に設定

---

## E2E統合テスト手順（T8）

ユニットテストでは検証できない統合動作を確認するため、以下のE2Eテストシナリオを実施します。

### 前提条件

1. 開発サーバーが起動している（`npm run dev`）
2. Stripe CLIが起動している（`stripe listen --forward-to localhost:5173/api/stripe/webhook`）
3. SupabaseがローカルまたはDev環境で起動している
4. Stripe Test Mode APIキーが`.env`に設定されている

### シナリオ1: 個人課金の新規サブスクリプション（正常系）

このシナリオでは、API呼び出し → Webhook受信 → DB更新の全経路を検証します。

#### ステップ1: 初期状態の確認

Supabase Studioで`subscriptions`テーブルを開き、テストユーザーのレコードを確認：

```sql
SELECT * FROM subscriptions WHERE user_id = 'test-user-id';
```

現在の`plan_type`と`stripe_subscription_id`を記録します。

#### ステップ2: Checkout Sessionを作成

ブラウザでログインし、個人課金のCheckoutページへ移動：

```
http://localhost:5173/pricing
```

「Standard プラン」の「月額プランを選択」をクリックし、Stripe Checkoutページへ遷移します。

#### ステップ3: テストカードで決済

Stripeのテストカード番号を使用：

```
カード番号: 4242 4242 4242 4242
有効期限: 12/34（将来の任意の日付）
CVC: 123
郵便番号: 12345
```

「支払う」をクリックして決済を完了します。

#### ステップ4: Webhook受信を確認

Stripe CLIのターミナルで、以下のようなログが表示されることを確認：

```
[Webhook] イベント受信: checkout.session.completed ID: evt_xxxxx
[Webhook] Checkout完了: cs_xxxxx
[Webhook] subscriptions更新成功: test-user-id standard
```

開発サーバーのターミナルでも同様のログが確認できます。

#### ステップ5: DB更新を検証

Supabase Studioで再度確認：

```sql
SELECT
  user_id,
  plan_type,
  billing_interval,
  status,
  stripe_customer_id,
  stripe_subscription_id,
  current_period_start,
  current_period_end,
  cancel_at_period_end
FROM subscriptions
WHERE user_id = 'test-user-id';
```

**期待される結果:**
- `plan_type` = `'standard'`
- `billing_interval` = `'month'`
- `status` = `'active'`
- `stripe_customer_id` = `'cus_xxxxx'`（新規作成または既存）
- `stripe_subscription_id` = `'sub_xxxxx'`（新規作成）
- `current_period_start` と `current_period_end` が設定されている
- `cancel_at_period_end` = `false`

#### ステップ6: Stripe Dashboardで確認

[Stripe Dashboard（テストモード）](https://dashboard.stripe.com/test/subscriptions)でサブスクリプションを確認：

1. **Subscriptions** ページで新規サブスクリプションが作成されている
2. ステータスが `Active`
3. メタデータに `user_id` が設定されている

### シナリオ2: 組織課金の新規サブスクリプション（正常系）

#### ステップ1: 組織作成

アプリケーションで新規組織を作成：

```
http://localhost:5173/organizations/new
```

組織名を入力し、「作成」をクリック。組織IDをメモします。

#### ステップ2: Checkout Sessionを作成

組織の設定ページから課金プランを選択：

```
http://localhost:5173/organizations/[org-id]/settings/billing
```

「Basic プラン」の「月額プランを選択」をクリック。

#### ステップ3: テストカードで決済

シナリオ1と同じテストカード情報で決済を完了します。

#### ステップ4: Webhook受信を確認

Stripe CLIのターミナルで確認：

```
[Webhook] イベント受信: checkout.session.completed ID: evt_xxxxx
[Webhook] Checkout完了: cs_xxxxx
[Webhook] 組織作成: org_xxxxx プラン: basic
[Webhook] subscriptions更新成功: test-user-id basic
```

#### ステップ5: DB更新を検証

複数テーブルを確認：

```sql
-- organizationsテーブル
SELECT id, name, plan_type, max_members, stripe_customer_id, stripe_subscription_id
FROM organizations
WHERE id = 'org-id';

-- organization_membersテーブル
SELECT organization_id, user_id, role
FROM organization_members
WHERE organization_id = 'org-id';

-- subscriptionsテーブル
SELECT user_id, organization_id, plan_type, status, stripe_subscription_id
FROM subscriptions
WHERE organization_id = 'org-id';
```

**期待される結果:**
- `organizations`: `plan_type='basic'`, `max_members=10`, `stripe_customer_id`と`stripe_subscription_id`が設定されている
- `organization_members`: 作成者が`role='admin'`で登録されている
- `subscriptions`: `organization_id`が設定され、`plan_type='basic'`, `status='active'`

### シナリオ3: サブスクリプションキャンセル

#### ステップ1: Customer Portalへアクセス

個人課金の場合：

```
http://localhost:5173/settings/billing
```

「プランを管理」をクリックしてStripe Customer Portalへ遷移します。

#### ステップ2: サブスクリプションをキャンセル

Customer Portalで「サブスクリプションをキャンセル」→「キャンセルを確定」をクリック。

#### ステップ3: Webhook受信を確認

```
[Webhook] イベント受信: customer.subscription.deleted ID: evt_xxxxx
[Webhook] Subscriptionキャンセル: sub_xxxxx
[Webhook] subscriptionsをフリープランに降格: sub_xxxxx
```

#### ステップ4: DB更新を検証

```sql
SELECT plan_type, status, stripe_subscription_id, cancel_at_period_end
FROM subscriptions
WHERE user_id = 'test-user-id';
```

**期待される結果:**
- `plan_type` = `'free'`
- `status` = `'canceled'`
- `stripe_subscription_id` = `NULL`
- `cancel_at_period_end` = `NULL`

### トラブルシューティング

#### Webhookが届かない

1. Stripe CLIが起動しているか確認
2. 開発サーバーのポート番号が正しいか確認（`localhost:5173`）
3. Webhook Signing Secretが`.env`に正しく設定されているか確認

#### DBが更新されない

1. 開発サーバーのログでエラーを確認
2. Supabaseへの接続情報が正しいか確認（`.env`の`SUPABASE_URL`と`SUPABASE_SERVICE_ROLE_KEY`）
3. テーブルのRLS（Row Level Security）設定を確認

#### 決済エラー

1. Stripe Test Modeになっているか確認
2. `.env`の`STRIPE_SECRET_KEY`がテストキー（`sk_test_`）であることを確認
3. Price IDが正しく設定されているか確認（`.env`の`STRIPE_PRICE_*`）

### CI/CD環境での実行

E2E統合テストは実際のStripe CLIとローカル環境が必要なため、CI/CD環境では実行できません。
ユニットテスト（`/src/lib/server/__tests__/`）がモックを使用してWebhook処理をカバーしています。

手動でのE2E確認は、以下のタイミングで実施することを推奨：
- Stripe統合機能の大幅な変更後
- 本番デプロイ前の最終確認
- Stripe APIバージョンアップグレード後

---

これで Stripe CLI のセットアップが完了です！
