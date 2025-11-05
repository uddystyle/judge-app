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

これで Stripe CLI のセットアップが完了です！
