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

## 実装チケット（優先度順）

以下は、そのままIssue化して着手できる粒度のチケットです。

### [P0] T1: `checkout.session.completed` metadata検証の厳格化
- 対象:
  - `/src/routes/api/stripe/webhook/+server.ts`
  - `/src/lib/server/__tests__/stripe.webhook.test.ts`
- 目的: `metadata` 欠落/不正値で不正データが保存されるのを防止する
- 実装タスク:
  - `user_id` / `subscription` / `is_organization` / `is_upgrade` / `max_members` の必須・型・値域を検証
  - 4xx/5xx分類ポリシー（`NonRetryableError` / `RetryableError`）を維持
- テストタスク:
  - 欠落パターン: `user_id` なし、`subscription` なし
  - 不正値パターン: `max_members` が数値変換不可、`is_upgrade` が想定外文字列
- 受け入れ条件:
  - 不正入力時に期待HTTPコードを返す
  - `subscriptions` / `organizations` に不正値が保存されない

### [P0] T2: Price ID未知・環境変数未設定の防御
- 対象:
  - `/src/routes/api/stripe/webhook/+server.ts`
  - `/src/lib/server/__tests__/stripe.webhook.test.ts`
- 目的: 未知priceで誤った `plan_type` が保存されることを防止する
- 実装タスク:
  - price->plan変換で未知ID/未設定envを明示エラー化
  - 暗黙フォールバック（誤ったデフォルト値）を禁止
- テストタスク:
  - 未知price ID
  - 必須price env未設定
- 受け入れ条件:
  - エラーで処理停止し、誤プランが保存されない

### [P0] T3: Stripe API障害時の応答統一
- 対象:
  - `/src/routes/api/stripe/webhook/+server.ts`
  - `/src/routes/api/stripe/customer-portal/+server.ts`
  - `/src/routes/api/stripe/create-portal-session/+server.ts`
  - `/src/lib/server/__tests__/stripe.webhook.test.ts`
  - `/src/lib/server/__tests__/stripe.checkout-api.test.ts`
- 目的: Stripe API失敗時のハンドリング不整合をなくす
- 実装タスク:
  - `stripe.subscriptions.retrieve` / `billingPortal.sessions.create` 失敗時のレスポンス方針を統一
  - 既存4xx（入力不備/認可不足）は再throwして保持
- テストタスク:
  - `retrieve` 例外 -> 想定コード
  - `billingPortal` 例外 -> 想定コード
- 受け入れ条件:
  - 4xxを潰さず、Stripe障害は規定どおりの失敗になる

### [P0] T4: Webhook順序逆転時の最終整合性
- 対象:
  - `/src/routes/api/stripe/webhook/+server.ts`
  - `/src/lib/server/__tests__/stripe.webhook.test.ts`
- 目的: イベント到着順が前後しても最終状態を正に保つ
- 実装タスク:
  - `customer.subscription.deleted` -> `checkout.session.completed` / `customer.subscription.updated` の逆順到着を検証
  - 必要なら分岐ガードを追加
- テストタスク:
  - 逆順シーケンステストを追加（同一 `subscription_id`）
- 受け入れ条件:
  - 最終 `subscriptions` / `organizations` 状態が期待値で収束する

### [P1] T5: 重複配送の強化（別event.id・同subscription.id）
- 対象:
  - `/src/routes/api/stripe/webhook/+server.ts`
  - `/src/lib/server/__tests__/stripe.webhook.test.ts`
- 目的: `event.id` 差異があっても同一契約の二重反映を防ぐ
- 実装タスク:
  - 同一 `subscription.id` の再処理安全性を確認し、必要ならガード追加
- テストタスク:
  - 異なる `event.id` で同一 `subscription.id` を2回送る
- 受け入れ条件:
  - 二重課金状態/重複更新が発生しない

### [P1] T6: DB部分失敗後の再実行収束
- 対象:
  - `/src/routes/api/stripe/webhook/+server.ts`
  - `/src/lib/server/__tests__/stripe.webhook.test.ts`
- 目的: 組織フロー途中失敗時に再送で整合状態へ回復させる
- 実装タスク:
  - `organization_members` 失敗時/`subscriptions` 失敗時の再実行パスを確認
  - 失敗が致命/非致命の分類を明文化
- テストタスク:
  - 1回目失敗、2回目成功のシナリオ
- 受け入れ条件:
  - 最終的に整合したデータ状態へ収束する

### [P1] T7: 取消・回復イベントの状態遷移網羅
- 対象:
  - `/src/routes/api/stripe/webhook/+server.ts`
  - `/src/lib/server/__tests__/stripe.webhook.test.ts`
- 目的: `past_due` からの回復や契約終了設定の反映漏れを防ぐ
- 実装タスク:
  - `invoice.payment_failed` -> `invoice.payment_succeeded` 連続処理を検証
  - `cancel_at_period_end` 反映の確認
- テストタスク:
  - 失敗後成功で `status=active` に戻る
  - `cancel_at_period_end` true/false が期待どおり保存
- 受け入れ条件:
  - 連続イベント後の `status` / 期間 / cancel設定が整合

### [P2] T8: Stripe CLI経路の最小E2E
- 対象:
  - 追加: `/tests/e2e/stripe-subscription.e2e.test.ts`（推奨）
  - 参照: `/docs/stripe-cli-setup.md`
- 目的: ユニットモックでは拾いにくい統合不整合を検知する
- 実装タスク:
  - API -> Webhook -> DB更新の最小1シナリオを自動化
  - ローカル再現手順をREADMEまたは本ドキュメントに記載
- テストタスク:
  - 正常系1本（個人または組織のどちらか優先度高い方）
- 受け入れ条件:
  - ローカル/CIで再現可能な最小E2Eが1本通る

### [P0] T9: `is_upgrade=true` かつ `organization_id` 欠落時の防御
- 対象:
  - `/src/routes/api/stripe/webhook/+server.ts`
  - `/src/lib/server/__tests__/stripe.webhook.test.ts`
- 目的: アップグレードイベントの不正metadataで意図しない組織新規作成を防ぐ
- 実装タスク:
  - `is_upgrade === true` の場合は `organization_id` を必須化
  - 欠落時は `NonRetryableError`（400）で中断
- テストタスク:
  - `checkout.session.completed`（組織向け）で `is_upgrade=true` + `organization_id` なし
- 受け入れ条件:
  - 400を返し、`organizations` / `subscriptions` が作成・更新されない

### [P0] T10: Stripe Subscriptionレスポンス異常データ防御
- 対象:
  - `/src/routes/api/stripe/webhook/+server.ts`
  - `/src/lib/server/__tests__/stripe.webhook.test.ts`
- 目的: Stripe APIの部分欠落レスポンスで誤保存・クラッシュを防ぐ
- 実装タスク:
  - `subscription.items.data` 空配列、`price` 欠落、`recurring` 欠落時のガード追加
  - 分類は `RetryableError` / `NonRetryableError` を明文化
- テストタスク:
  - `items.data=[]`
  - `items.data[0].price` が `undefined`
- 受け入れ条件:
  - 安全に失敗し、500または規定のエラーコードで返る
  - 不完全データがDBに保存されない

### [P1] T11: `customer.subscription.updated` の未知Price ID防御
- 対象:
  - `/src/routes/api/stripe/webhook/+server.ts`
  - `/src/lib/server/__tests__/stripe.webhook.test.ts`
- 目的: 更新イベント経由で未知priceが入り込んでも誤った `plan_type` を保存しない
- 実装タスク:
  - `subscription.updated` ハンドラでも price判定ロジックを厳格適用
- テストタスク:
  - `customer.subscription.updated` で未知price ID
- 受け入れ条件:
  - 明示エラーで中断し、既存レコードが不正上書きされない

### [P1] T12: Portal APIのStripeエラー種別テスト
- 対象:
  - `/src/routes/api/stripe/customer-portal/+server.ts`
  - `/src/routes/api/stripe/create-portal-session/+server.ts`
  - `/src/lib/server/__tests__/stripe.checkout-api.test.ts`
- 目的: Stripe側エラー種別が変わっても想定レスポンスを維持する
- 実装タスク:
  - `StripeCardError` 相当 / タイムアウト / 429 の扱いを方針化
- テストタスク:
  - `billingPortal.sessions.create` でエラー種別ごとのモック
- 受け入れ条件:
  - 想定どおりのHTTPコードとエラーメッセージ形式を返す

### [P1] T13: Webhookリプレイ（古いイベント）耐性テスト
- 対象:
  - `/src/routes/api/stripe/webhook/+server.ts`
  - `/src/lib/server/__tests__/stripe.webhook.test.ts`
- 目的: 署名が正しい過去イベント再送による状態巻き戻りを防ぐ
- 実装タスク:
  - 「許容する/拒否する」の方針を明文化し、実装を一致させる
  - 必要に応じてイベント時刻または状態比較ガードを追加
- テストタスク:
  - 新しい状態確定後に古いイベントを再送するシナリオ
- 受け入れ条件:
  - 想定した方針どおりに処理され、最終状態が巻き戻らない

### [P1] T14: `livemode` 不一致イベントの防御
- 対象:
  - `/src/routes/api/stripe/webhook/+server.ts`
  - `/src/lib/server/__tests__/stripe.webhook.test.ts`
- 目的: 本番環境でテストイベント（または逆）を誤処理しない
- 実装タスク:
  - 環境と `event.livemode` の整合チェックを追加
  - 不一致時の扱い（400で拒否/200で無視）を明文化
- テストタスク:
  - `livemode=true/false` の不一致ケース
- 受け入れ条件:
  - 不一致イベントがDB更新されない

### [P1] T15: `checkout.session.completed` で `subscription=null` の防御
- 対象:
  - `/src/routes/api/stripe/webhook/+server.ts`
  - `/src/lib/server/__tests__/stripe.webhook.test.ts`
- 目的: サブスクリプションID欠落時の誤保存を防ぐ
- 実装タスク:
  - `subscription` 欠落時の明示エラー分岐を維持
- テストタスク:
  - `checkout.session.completed` で `subscription: null`
- 受け入れ条件:
  - 期待HTTPコードを返し、DB更新されない

### [P1] T16: `customer.subscription.deleted` 再送多重耐性
- 対象:
  - `/src/routes/api/stripe/webhook/+server.ts`
  - `/src/lib/server/__tests__/stripe.webhook.test.ts`
- 目的: 削除イベント再送時の二重降格や整合性崩壊を防ぐ
- 実装タスク:
  - 同一削除イベント再送時も安全な分岐を担保
- テストタスク:
  - 同一 `subscription.id` の `deleted` を複数回送信
- 受け入れ条件:
  - `subscriptions` / `organizations` の最終状態が不変

### [P1] T17: `plan_limits` 欠落時のイベント網羅
- 対象:
  - `/src/routes/api/stripe/webhook/+server.ts`
  - `/src/lib/server/__tests__/stripe.webhook.test.ts`
- 目的: プラン情報欠落時の失敗挙動を全イベントで統一する
- 実装タスク:
  - `created` / `updated` / `deleted` で `plan_limits` 取得失敗時の扱いを整理
- テストタスク:
  - 各イベントで `plan_limits` 取得エラーをモック
- 受け入れ条件:
  - イベントごとに規定の失敗コードとメッセージを返す

### [P1] T18: Stripe API一時障害後の再送回復
- 対象:
  - `/src/routes/api/stripe/webhook/+server.ts`
  - `/src/lib/server/__tests__/stripe.webhook.test.ts`
- 目的: 一時的障害後の再送で正しい最終状態に収束させる
- 実装タスク:
  - 初回 `RetryableError`、再送成功の収束パスを確認
- テストタスク:
  - `subscriptions.retrieve` 失敗 -> 次回成功シナリオ
- 受け入れ条件:
  - 最終的に正しい課金状態へ回復する

### [P2] T19: 重要フィールド不正型の防御
- 対象:
  - `/src/routes/api/stripe/webhook/+server.ts`
  - `/src/lib/server/__tests__/stripe.webhook.test.ts`
- 目的: 不正型データによる破損保存を防ぐ
- 実装タスク:
  - `current_period_end` / `status` 等の型・値検証を追加
- テストタスク:
  - timestamp不正、status想定外文字列
- 受け入れ条件:
  - 不正データは保存されず、規定エラーで停止する

### [P2] T20: 未対応イベントの監視性テスト
- 対象:
  - `/src/routes/api/stripe/webhook/+server.ts`
  - `/src/lib/server/__tests__/stripe.webhook.test.ts`
- 目的: 未対応イベント受信時の観測可能性を担保する
- 実装タスク:
  - 未対応イベント時のログ/メトリクス出力方針を明文化
- テストタスク:
  - 未対応 `event.type` で 200返却 + ログ出力確認
- 受け入れ条件:
  - 正常応答を維持しつつ、監視可能な痕跡が残る

### [P1] T21: Portal API認可境界の追加テスト
- 対象:
  - `/src/routes/api/stripe/customer-portal/+server.ts`
  - `/src/routes/api/stripe/create-portal-session/+server.ts`
  - `/src/lib/server/__tests__/stripe.checkout-api.test.ts`
- 目的: 境界ユーザー状態での誤アクセスを防ぐ
- 実装タスク:
  - 退会済みメンバー/無効化ユーザー/削除済み組織の扱いを明文化
- テストタスク:
  - 各境界ケースで 403/404 を確認
- 受け入れ条件:
  - 想定外ユーザー状態でもPortalアクセスが通らない

## 実施順と完了判定
1. T1-T4（P0）を先に完了し、WebhookとPortalの事故リスクを先に閉じる
2. T5-T7（P1）で再送・部分失敗・状態遷移の耐性を上げる
3. T9-T10（P0追加）で課金データ破壊リスクを先に閉じる
4. T11-T13（P1追加）で更新系/リプレイ耐性を補強する
5. T14-T18,T21（追加P1）で本番運用時の境界事故を抑止する
6. T19-T20（追加P2）を整備する
7. T8（P2）で統合経路の最終確認を入れる

各チケットの完了条件:
- 対象テストが追加され、失敗ケースが再現できること
- 実装修正後にテストがパスすること
- 既存Stripeテスト（`stripe.webhook.test.ts` / `stripe.checkout-api.test.ts`）が回帰なく通ること

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
