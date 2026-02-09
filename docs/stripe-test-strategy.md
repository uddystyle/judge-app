# Stripe連携 テスト方針

## 目的
Stripe連携は外部API呼び出しと非同期Webhook処理を含むため、通常のユニットテストだけでは回帰を検知しにくい領域です。
本ドキュメントでは、課金ロジックの安全性を担保するためのテスト対象と優先順位を定義します。

## 対象範囲
- `/src/routes/api/stripe/webhook/+server.ts`
- `/src/routes/api/stripe/create-checkout-session/+server.ts`
- `/src/routes/api/stripe/create-organization-checkout/+server.ts`
- `/src/routes/api/stripe/upgrade-organization/+server.ts`
- 必要に応じて `customer-portal` / `create-portal-session` も追加

## テストレベル
1. ハンドラ単体テスト
- SvelteKit `RequestHandler` を直接呼び出し、HTTPステータス/レスポンスを検証する。
- Stripe SDK と Supabase はモックする。

2. イベント分岐テスト
- Webhookイベントタイプごとの分岐とDB更新内容を検証する。

3. べき等性テスト
- 同一Webhook再送時に重複レコードや不整合が起きないことを検証する。

## 優先度P0（最優先）

### 1) Webhook署名検証
ファイル: `/src/routes/api/stripe/webhook/+server.ts`
- `stripe-signature` ヘッダなし -> 400
- 署名不正 (`constructEvent` が例外) -> 400
- 署名正当 -> イベント処理へ進む

### 2) Webhookエラー分類（再試行制御）
ファイル: `/src/routes/api/stripe/webhook/+server.ts`
- `NonRetryableError` -> 400
- `RetryableError` -> 500
- 未分類の例外 -> 500

### 3) `checkout.session.completed` の主要分岐
ファイル: `/src/routes/api/stripe/webhook/+server.ts`
- 個人課金: `subscriptions` が期待値で upsert される
- 組織新規: `organizations` / `organization_members` / `subscriptions` が作成/更新される
- 組織アップグレード: 旧subscriptionクリア + `organizations` 更新 + 新subscription upsert

### 4) べき等性
ファイル: `/src/routes/api/stripe/webhook/+server.ts`
- 同一イベント再送時、重複作成されず安全に再実行できる
- `upsert` の `onConflict` 仕様に沿って動作する

### 5) Checkout APIの入力検証と認可
ファイル:
- `/src/routes/api/stripe/create-checkout-session/+server.ts`
- `/src/routes/api/stripe/create-organization-checkout/+server.ts`
- `/src/routes/api/stripe/upgrade-organization/+server.ts`

検証項目:
- 未認証ユーザー（401/redirect）
- 必須パラメータ不足（400）
- `planType` 不正（400）
- `billingInterval` 不正（400）
- `upgrade-organization` で admin 権限なし（403）

## 優先度P1（次点）

### 1) Price ID未設定時の失敗
- placeholder検出時に適切に失敗する（500）

### 2) 請求イベントの状態遷移
ファイル: `/src/routes/api/stripe/webhook/+server.ts`
- `invoice.payment_succeeded` -> `subscriptions.status = active` かつ期間更新
- `invoice.payment_failed` -> `subscriptions.status = past_due`

### 3) `customer.subscription.deleted` の分岐
- 削除対象が現行subscriptionのときのみ組織をfreeへ降格
- 旧subscription削除（アップグレード中の古い契約）では組織を更新しない

## 優先度P2（余力があれば）
- Stripe API一時障害時のリトライ対象判定
- ログメッセージ/監視フックの検証（必要性が明確な場合のみ）
- `customer-portal` / `create-portal-session` APIの回帰テスト

## モック方針

### Stripeモック
- `vi.mock('$lib/server/stripe', () => ({ stripe: ... }))`
- 主要モック対象:
  - `stripe.webhooks.constructEvent`
  - `stripe.subscriptions.retrieve`
  - `stripe.checkout.sessions.create`
  - `stripe.customers.create`

### Supabaseモック
- `from().select().eq().single()` 連鎖を段階的にモック
- `upsert()`, `update()`, `insert()` の引数を厳密に検証
- 「呼ばれたこと」だけでなく、更新内容（status, plan_type, periodなど）も検証する

## 推奨テストファイル配置
SvelteKitの`+`予約プレフィックス警告を避けるため、ルート直下ではなく以下を推奨:
- `/src/lib/server/__tests__/stripe.webhook.test.ts`
- `/src/lib/server/__tests__/stripe.checkout-api.test.ts`

## 完了条件（Definition of Done）
1. P0テストが全て実装済みでCI通過
2. Webhook再送（同一イベントID）時の安全性が担保されている
3. 課金ステータス遷移（active/past_due/canceled/free）の回帰テストが存在する
4. テストが「実装呼び出し有無」ではなく「データ整合性」を検証している
