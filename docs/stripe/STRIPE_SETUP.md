# Stripe設定ガイド - 組織向けプラン

このドキュメントでは、組織向けプラン（Basic/Standard/Enterprise）のStripe設定方法を説明します。

## 前提条件

- Stripeアカウントが作成済み
- `STRIPE_SECRET_KEY` が環境変数に設定済み
- `STRIPE_WEBHOOK_SECRET` が環境変数に設定済み

## 1. Stripeダッシュボードでの製品作成

### Basic プラン

1. Stripeダッシュボードの「製品」ページへ移動
2. 「製品を追加」をクリック
3. 以下の情報を入力：
   - **製品名**: TENTO 組織プラン - ベーシック
   - **説明**: 検定員10名まで、セッション無制限
   - **料金モデル**: 定期的な支払い

4. **月額プラン**を作成：
   - 料金: ¥5,980
   - 請求期間: 毎月
   - Price IDをコピーして保存（例: `price_xxxxx`）

5. **年額プラン**を作成：
   - 「別の料金を追加」をクリック
   - 料金: ¥59,800
   - 請求期間: 毎年
   - Price IDをコピーして保存（例: `price_yyyyy`）

### Standard プラン

1. 「製品を追加」をクリック
2. 以下の情報を入力：
   - **製品名**: TENTO 組織プラン - スタンダード
   - **説明**: 検定員30名まで、セッション無制限
   - **料金モデル**: 定期的な支払い

3. **月額プラン**を作成：
   - 料金: ¥14,800
   - 請求期間: 毎月
   - Price IDをコピーして保存

4. **年額プラン**を作成：
   - 料金: ¥148,000
   - 請求期間: 毎年
   - Price IDをコピーして保存

### Enterprise プラン

1. 「製品を追加」をクリック
2. 以下の情報を入力：
   - **製品名**: TENTO 組織プラン - エンタープライズ
   - **説明**: 検定員無制限、セッション無制限
   - **料金モデル**: 定期的な支払い

3. **月額プラン**を作成：
   - 料金: ¥29,800
   - 請求期間: 毎月
   - Price IDをコピーして保存

4. **年額プラン**を作成：
   - 料金: ¥298,000
   - 請求期間: 毎年
   - Price IDをコピーして保存

## 2. 環境変数の設定

`.env` ファイルに以下の環境変数を追加してください：

```bash
# 組織向けプラン - Basic
STRIPE_PRICE_BASIC_MONTH=price_xxxxxxxxxxxxxxxxxxxxx
STRIPE_PRICE_BASIC_YEAR=price_yyyyyyyyyyyyyyyyyyyyyyy

# 組織向けプラン - Standard
STRIPE_PRICE_STANDARD_MONTH=price_xxxxxxxxxxxxxxxxxxxxx
STRIPE_PRICE_STANDARD_YEAR=price_yyyyyyyyyyyyyyyyyyyyyyy

# 組織向けプラン - Enterprise
STRIPE_PRICE_ENTERPRISE_MONTH=price_xxxxxxxxxxxxxxxxxxxxx
STRIPE_PRICE_ENTERPRISE_YEAR=price_yyyyyyyyyyyyyyyyyyyyyyy
```

**注意**: `price_xxxxx` の部分を、ステップ1でコピーした実際のPrice IDに置き換えてください。

## 3. 動作確認

### テスト環境での確認

1. アプリケーションを起動：
```bash
npm run dev
```

2. ログイン後、ダッシュボードの「組織を作成」ボタンをクリック

3. 組織名とプランを選択して「次へ（お支払いページへ）」をクリック

4. Stripe Checkoutページが表示されることを確認

5. **テストカード番号**を使用して支払いをテスト：
   - カード番号: `4242 4242 4242 4242`
   - 有効期限: 任意の未来の日付
   - CVC: 任意の3桁の数字

6. 支払い完了後、ダッシュボードにリダイレクトされることを確認

7. Supabaseダッシュボードで以下を確認：
   - `organizations` テーブルに新しい組織が作成されている
   - `organization_members` テーブルに管理者として追加されている
   - `subscriptions` テーブルに組織IDが関連付けられている

### Webhookのログ確認

StripeダッシュボードまたはStripe CLIを使用して、Webhookイベントが正常に処理されているか確認してください：

```bash
stripe listen --forward-to localhost:5173/api/stripe/webhook
```

期待されるイベント：
1. `checkout.session.completed` - 組織作成処理が実行される
2. `customer.subscription.created` - サブスクリプション情報が保存される

## 4. 本番環境への適用

本番環境では、テストモードのPrice IDではなく、本番モードのPrice IDを使用してください：

1. Stripeダッシュボードの右上で「テストモード」を「本番モード」に切り替え
2. 同じ手順で製品とプランを作成
3. 本番環境の環境変数に本番モードのPrice IDを設定

## トラブルシューティング

### エラー: "Stripe Price IDが設定されていません"

- 環境変数が正しく設定されているか確認してください
- アプリケーションを再起動してください（環境変数の変更後）

### Webhookが動作しない

- `STRIPE_WEBHOOK_SECRET` が正しく設定されているか確認
- Stripe CLIまたはStripeダッシュボードでWebhook URLが登録されているか確認
- Webhookエンドポイント: `https://yourdomain.com/api/stripe/webhook`

### 組織が作成されない

- ブラウザのコンソールログとサーバーログを確認
- Supabase RLSポリシーが正しく設定されているか確認
- `SUPABASE_SERVICE_ROLE_KEY` が正しく設定されているか確認

## 参考資料

- [Stripe製品とプラン](https://stripe.com/docs/billing/prices-guide)
- [Stripe Checkout](https://stripe.com/docs/payments/checkout)
- [Stripe Webhooks](https://stripe.com/docs/webhooks)
