# Stripe本番環境移行ガイド

このガイドでは、Stripeをテストモードから本番モードへVercel環境で移行する手順を説明します。

## 目次

1. [前提条件](#前提条件)
2. [Stripe本番環境のセットアップ](#stripe本番環境のセットアップ)
3. [Vercel環境変数の設定](#vercel環境変数の設定)
4. [Webhookの設定](#webhookの設定)
5. [動作確認](#動作確認)
6. [トラブルシューティング](#トラブルシューティング)

---

## 前提条件

- [ ] Stripeアカウントが本番環境で有効化されている
- [ ] Vercelプロジェクトがデプロイされている
- [ ] 本番環境のドメイン: `https://tentoapp.com`
- [ ] テストモードで全機能が正常に動作することを確認済み

---

## Stripe本番環境のセットアップ

### 1. Stripeダッシュボードで本番モードに切り替え

1. [Stripe Dashboard](https://dashboard.stripe.com/)にログイン
2. 左上のトグルスイッチを**「本番データを表示」**に切り替え

### 2. 本番用のProductとPriceを作成

#### Basic プラン

1. **Products** → **Add product** をクリック
2. 以下の情報を入力:
   - **Name**: `組織プラン - Basic`
   - **Description**: `10名までの組織向けプラン。15名の検定員を登録可能。`
   - **Pricing model**: `Standard pricing`

3. **月額料金** を追加:
   - **Price**: `8,800 JPY`
   - **Billing period**: `Monthly`
   - **Price description**: `Basic 月額プラン`
   - **Save** をクリック
   - **Price ID**をコピー（例: `price_xxxxxxxxxxxxx`）

4. **年額料金** を追加:
   - 同じProductページで **Add another price** をクリック
   - **Price**: `88,000 JPY`
   - **Billing period**: `Yearly`
   - **Price description**: `Basic 年額プラン`
   - **Save** をクリック
   - **Price ID**をコピー

#### Standard プラン

1. **Products** → **Add product** をクリック
2. 以下の情報を入力:
   - **Name**: `組織プラン - Standard`
   - **Description**: `30名までの組織向けプラン。50名の検定員を登録可能。`

3. **月額料金** を追加:
   - **Price**: `24,800 JPY`
   - **Billing period**: `Monthly`
   - **Price ID**をコピー

4. **年額料金** を追加:
   - **Price**: `248,000 JPY`
   - **Billing period**: `Yearly`
   - **Price ID**をコピー

#### Premium プラン

1. **Products** → **Add product** をクリック
2. 以下の情報を入力:
   - **Name**: `組織プラン - Premium`
   - **Description**: `100名までの組織向けプラン。100名の検定員を登録可能。`

3. **月額料金** を追加:
   - **Price**: `49,800 JPY`
   - **Billing period**: `Monthly`
   - **Price ID**をコピー

4. **年額料金** を追加:
   - **Price**: `498,000 JPY`
   - **Billing period**: `Yearly`
   - **Price ID**をコピー

### 3. 本番用APIキーを取得

1. **Developers** → **API keys** に移動
2. **本番データを表示**モードになっていることを確認
3. 以下のキーをコピー:
   - **Publishable key** (pk*live* で始まる)
   - **Secret key** (sk*live* で始まる) - **Reveal live key** をクリック

---

## Vercel環境変数の設定

### 1. Vercelダッシュボードにアクセス

1. [Vercel Dashboard](https://vercel.com/)にログイン
2. プロジェクトを選択
3. **Settings** → **Environment Variables** に移動

### 2. Stripe関連の環境変数を追加

以下の環境変数を**Production**環境に追加します:

#### APIキー

| Variable Name                   | Value                   | Environment |
| ------------------------------- | ----------------------- | ----------- |
| `PUBLIC_STRIPE_PUBLISHABLE_KEY` | `pk_live_xxxxxxxxxxxxx` | Production  |
| `STRIPE_SECRET_KEY`             | `sk_live_xxxxxxxxxxxxx` | Production  |

#### Price IDs - Basic

| Variable Name              | Value                                | Environment |
| -------------------------- | ------------------------------------ | ----------- |
| `STRIPE_PRICE_BASIC_MONTH` | 手順2でコピーしたBasic月額のPrice ID | Production  |
| `STRIPE_PRICE_BASIC_YEAR`  | 手順2でコピーしたBasic年額のPrice ID | Production  |

#### Price IDs - Standard

| Variable Name                 | Value                                   | Environment |
| ----------------------------- | --------------------------------------- | ----------- |
| `STRIPE_PRICE_STANDARD_MONTH` | 手順2でコピーしたStandard月額のPrice ID | Production  |
| `STRIPE_PRICE_STANDARD_YEAR`  | 手順2でコピーしたStandard年額のPrice ID | Production  |

#### Price IDs - Premium

| Variable Name                | Value                                  | Environment |
| ---------------------------- | -------------------------------------- | ----------- |
| `STRIPE_PRICE_PREMIUM_MONTH` | 手順2でコピーしたPremium月額のPrice ID | Production  |
| `STRIPE_PRICE_PREMIUM_YEAR`  | 手順2でコピーしたPremium年額のPrice ID | Production  |

### 3. Webhook Secret（後で設定）

Webhook Secretは次のセクションで取得後に設定します。

---

## Webhookの設定

### 1. Webhookエンドポイントの作成

1. Stripeダッシュボードで **Developers** → **Webhooks** に移動
2. **本番データを表示**モードになっていることを確認
3. **Add endpoint** をクリック
4. 以下の情報を入力:
   - **Endpoint URL**: `https://tentoapp.com/api/stripe/webhook`

   - **Description**: `本番環境 - Stripe Webhook`

   - **Listen to**: `Events on your account` を選択

   - **Select events to listen to**: 以下のイベントを選択
     - `checkout.session.completed`
     - `customer.subscription.created`
     - `customer.subscription.updated`
     - `customer.subscription.deleted`
     - `invoice.payment_succeeded`
     - `invoice.payment_failed`

5. **Add endpoint** をクリック

### 2. Webhook Signing Secretを取得

1. 作成したWebhookエンドポイントをクリック
2. **Signing secret** セクションで **Reveal** をクリック
3. `whsec_` で始まるシークレットをコピー

### 3. Webhook SecretをVercelに設定

1. Vercelダッシュボードに戻る
2. **Settings** → **Environment Variables** に移動
3. 以下の環境変数を追加:

| Variable Name           | Value                 | Environment |
| ----------------------- | --------------------- | ----------- |
| `STRIPE_WEBHOOK_SECRET` | `whsec_xxxxxxxxxxxxx` | Production  |

### 4. Vercelを再デプロイ

環境変数を追加した後、アプリケーションを再デプロイする必要があります:

1. Vercelダッシュボードの **Deployments** タブに移動
2. 最新のデプロイメントの右側の **︙** メニューをクリック
3. **Redeploy** を選択
4. **Redeploy** を確認

または、ローカルで以下のコマンドを実行:

```bash
git commit --allow-empty -m "Redeploy for Stripe production environment variables"
git push
```

---

## 動作確認

### 1. 本番環境でのテスト準備

⚠️ **重要**: 本番環境では実際の決済が発生します。テストには以下の方法を推奨します:

#### 方法1: 小額テスト（推奨）

1. 実際に最小プラン（Basic月額 ¥8,800）でサブスクリプション登録
2. すぐにStripe Customer Portalからキャンセル
3. 必要に応じてStripeダッシュボードから返金処理

#### 方法2: プレビューのみ

1. チェックアウトページまで進む
2. 決済は完了せずにページを閉じる
3. UIとフローのみを確認

### 2. 動作確認チェックリスト

本番環境で以下の機能を確認してください:

#### 組織作成フロー（新規登録）

- [ ] `/organization/create` ページで組織名を入力
- [ ] プラン選択（Basic/Standard/Premium）
- [ ] 月額/年額の切り替え
- [ ] Stripeチェックアウトページへ遷移
- [ ] 決済情報入力（実際に決済するかプレビューのみ）
- [ ] 決済完了後、アカウントページに遷移
- [ ] 組織が作成され、正しいプランが表示される
- [ ] `organizations` テーブルに正しいデータが保存される

#### アップグレードフロー（フリー→有料）

- [ ] フリープランの組織を作成
- [ ] アカウントページで「プランをアップグレード」ボタンをクリック
- [ ] プラン選択ページでプランを選択
- [ ] Stripeチェックアウトページへ遷移
- [ ] 決済完了後、アカウントページに戻る
- [ ] プランが有料プランに更新される

#### プラン管理フロー（Customer Portal）

- [ ] 有料プランの組織でアカウントページを表示
- [ ] 「プランを管理」ボタンをクリック
- [ ] Stripe Customer Portalに遷移
- [ ] プラン変更/キャンセルオプションが表示される

#### Webhookの動作確認

1. Stripeダッシュボード → **Developers** → **Webhooks**
2. 作成したWebhookエンドポイントをクリック
3. テスト決済後、**Events** セクションで以下を確認:
   - イベントが受信されている（緑色のチェックマーク）
   - HTTPステータス: `200 OK`
   - 失敗がない（赤いエラーがない）

### 3. データベース確認

Supabaseダッシュボードで以下のテーブルを確認:

#### `organizations` テーブル

```sql
SELECT
  id,
  name,
  plan_type,
  max_members,
  stripe_customer_id,
  stripe_subscription_id
FROM organizations
WHERE id = 'your-organization-id';
```

確認項目:

- `plan_type` が選択したプラン（basic/standard/premium）と一致
- `max_members` が正しい値（10/30/100）
- `stripe_customer_id` が設定されている
- `stripe_subscription_id` が設定されている

#### `subscriptions` テーブル

```sql
SELECT
  user_id,
  organization_id,
  stripe_subscription_id,
  plan_type,
  billing_interval,
  status,
  current_period_start,
  current_period_end
FROM subscriptions
WHERE organization_id = 'your-organization-id';
```

確認項目:

- `plan_type` が正しい
- `billing_interval` が正しい（month/year）
- `status` が `active`
- `current_period_start` と `current_period_end` が設定されている

---

## トラブルシューティング

### Webhookが動作しない

#### 症状

- 決済完了後、プランが更新されない
- Stripeダッシュボードでエラーが表示される

#### 確認事項

1. **Webhook URLが正しいか**
   - Stripeダッシュボード → Webhooks → エンドポイントURL確認
   - `https://tentoapp.com/api/stripe/webhook` になっているか

2. **Webhook Secretが正しいか**
   - Vercelの環境変数 `STRIPE_WEBHOOK_SECRET` を確認
   - Stripeダッシュボードの Signing secret と一致するか

3. **監視イベントが設定されているか**
   - 最低限 `checkout.session.completed` が有効になっているか

4. **Vercelログを確認**

   ```bash
   vercel logs --prod
   ```

   - Webhook受信時のログを確認
   - エラーメッセージがないか確認

5. **Stripeダッシュボードでイベント詳細を確認**
   - Webhooks → エンドポイント → Events
   - 失敗したイベントをクリック
   - Response bodyにエラー情報が表示される

### プランが更新されない

#### 症状

- Webhookは成功しているがデータベースが更新されない

#### 確認事項

1. **環境変数のPrice IDが正しいか**
   - Vercelの環境変数を確認
   - Stripeで作成した本番用Price IDと一致するか

2. **ブラウザのコンソールログを確認**

   ```
   開発者ツール → Console
   ```

   - エラーメッセージがないか確認

3. **Supabase RLS（Row Level Security）**
   - Service Role Keyが正しく設定されているか
   - Webhookハンドラーが `supabaseAdmin` を使用しているか

### 決済が失敗する

#### 症状

- Stripeチェックアウトでエラーが発生

#### 確認事項

1. **APIキーが本番用か**
   - `PUBLIC_STRIPE_PUBLISHABLE_KEY` が `pk_live_` で始まっているか
   - `STRIPE_SECRET_KEY` が `sk_live_` で始まっているか

2. **Price IDが存在するか**
   - Stripeダッシュボード → Products
   - 環境変数のPrice IDが実際に存在するか確認

3. **Customer Portalの設定**
   - Stripeダッシュボード → Settings → Customer portal
   - ブランディングや利用規約が設定されているか

---

## 本番運用の注意事項

### 1. セキュリティ

- ✅ Webhook Secretは絶対に公開しない
- ✅ Secret Keyはサーバーサイドでのみ使用
- ✅ Publishable Keyはクライアントサイドで使用可能

### 2. モニタリング

定期的に以下を確認:

- Stripeダッシュボード → Webhooks でエラーがないか
- Vercelログでエラーがないか
- Supabaseでデータの整合性が取れているか

### 3. テストと本番の分離

- テストモードと本番モードを明確に分ける
- 開発環境ではテストモードのAPIキーを使用
- 本番環境では本番モードのAPIキーを使用

### 4. バックアップ

- 重要なデータベース変更前にバックアップを取る
- Stripe Productの設定をドキュメント化

---

## まとめ

このガイドに従って設定を行えば、Stripeの本番環境移行が完了します。

### チェックリスト

- [ ] Stripeで本番用Product/Priceを作成
- [ ] 本番用APIキーを取得
- [ ] Vercelに環境変数を設定
- [ ] Webhookエンドポイントを作成
- [ ] Webhook Secretを設定
- [ ] Vercelを再デプロイ
- [ ] 動作確認を実施
- [ ] データベースの整合性を確認

### 問題が発生した場合

1. このガイドの[トラブルシューティング](#トラブルシューティング)セクションを確認
2. Vercelログとブラウザコンソールを確認
3. Stripeダッシュボードでイベントとエラーを確認
4. Supabaseでデータを直接確認

---

## 参考リンク

- [Stripe Documentation](https://stripe.com/docs)
- [Stripe Webhooks](https://stripe.com/docs/webhooks)
- [Vercel Environment Variables](https://vercel.com/docs/concepts/projects/environment-variables)
- [Supabase Documentation](https://supabase.com/docs)
