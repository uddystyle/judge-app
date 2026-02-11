# Stripe E2E統合テスト

このディレクトリには、Stripe統合機能のE2E（End-to-End）テストが含まれています。

## テストの目的

ユニットテスト（モック使用）では検証できない以下の統合動作を確認します：

1. **API → Webhook → DB更新の完全な経路**
2. **Stripe APIとの実際の統合**
3. **複数サービス間のデータ整合性**

## テストの種類

### 1. 手動E2Eテスト（推奨）

実際のStripe CLIと開発環境を使用した完全な統合テスト。

**手順:**
詳細は[`/docs/stripe-cli-setup.md`](/docs/stripe-cli-setup.md)の「E2E統合テスト手順（T8）」セクションを参照してください。

**実施タイミング:**
- Stripe統合機能の大幅な変更後
- 本番デプロイ前の最終確認
- Stripe APIバージョンアップグレード後

**所要時間:** 約10-15分

### 2. 自動統合テスト（計画中）

**注意:** 実際のStripe CLIを使った完全自動化E2Eテストは、以下の理由により実装困難です：

- Stripe CLIの認証が必要（CI環境で困難）
- Webhookのローカルフォワーディングが必要
- 開発サーバーの起動が必要
- テスト用DBの準備が必要

代わりに、以下のアプローチで網羅しています：

1. **ユニットテスト**（`/src/lib/server/__tests__/`）
   - 全Webhook処理をモックでカバー
   - 54テストが実装済み

2. **手動E2Eテスト**（このディレクトリ）
   - 実際のStripe APIとWebhookを使用
   - ドキュメント化された手順で実施

## テスト範囲

### カバー済み（ユニットテスト）

- ✅ Webhook署名検証
- ✅ エラー分類（RetryableError / NonRetryableError）
- ✅ checkout.session.completed 分岐（個人/組織/アップグレード）
- ✅ べき等性（重複イベント処理）
- ✅ Checkout API入力検証と認可
- ✅ metadata検証の厳格化（T1）
- ✅ Price ID未知時の防御（T2）
- ✅ Stripe API障害時の応答統一（T3）
- ✅ Webhook順序逆転時の最終整合性（T4）
- ✅ 重複配送の強化（T5）
- ✅ DB部分失敗後の再実行収束（T6）
- ✅ 取消・回復イベントの状態遷移（T7）

### 要手動確認（E2Eテスト）

- 🔍 実際のStripe Checkoutフロー
- 🔍 実際のWebhook配送
- 🔍 Customer Portalの動作
- 🔍 複数テーブル間のデータ整合性
- 🔍 Stripe Dashboard上の表示

## ローカルでの実行方法

### 前提条件

1. Stripe CLIがインストール済み（`stripe --version`で確認）
2. Stripe Test Mode APIキーが設定済み
3. 開発サーバーが起動可能

### 手順

1. **Stripe CLIを起動**

```bash
stripe listen --forward-to localhost:5173/api/stripe/webhook
```

表示されたWebhook Signing Secretを`.env`の`STRIPE_WEBHOOK_SECRET`に設定します。

2. **開発サーバーを起動**

```bash
npm run dev
```

3. **テストシナリオを実行**

[`/docs/stripe-cli-setup.md`](/docs/stripe-cli-setup.md)の手順に従って、以下のシナリオを確認：

- シナリオ1: 個人課金の新規サブスクリプション
- シナリオ2: 組織課金の新規サブスクリプション
- シナリオ3: サブスクリプションキャンセル

## CI/CD環境での実行

**結論: CI環境では実行しません**

理由：
- Stripe CLIの認証が必要
- ローカル環境依存の設定が多数必要
- テスト実行時間が長い（10-15分）

代わりに、ユニットテストが以下をカバー：
- 全Webhook処理ロジック
- エラーハンドリング
- DB更新ロジック
- べき等性・順序逆転・部分失敗

## トラブルシューティング

問題が発生した場合は、[`/docs/stripe-cli-setup.md`](/docs/stripe-cli-setup.md)の「トラブルシューティング」セクションを参照してください。

## 今後の改善

以下の実装を検討中：

1. **Stripe Fixtures使用**
   - `stripe fixtures`コマンドでテストデータ作成を自動化

2. **Webhookイベント直接投稿**
   - Stripe CLIなしでWebhookエンドポイントへ直接POSTするスクリプト

3. **DB状態検証スクリプト**
   - テスト後のDB状態を自動検証するSQLスクリプト
