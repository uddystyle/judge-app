# E2Eテスト

このディレクトリには、以下のE2E（End-to-End）テストが含まれています：
1. **複数検定員のリアルタイム機能テスト** (`multi-judge-realtime.spec.ts`)
2. **Stripe統合機能テスト**（手動テスト）

---

## 1. 複数検定員のリアルタイム機能テスト

### 目的

本番環境相当のブラウザ環境で、以下を検証します：
- **二重遷移の防止**: 同一promptで複数回遷移しないこと
- **Realtime機能**: スコア更新、修正要求、セッション終了のリアルタイム反映
- **状態同期**: RealtimeとPollingフォールバックの競合がないこと

### テストケース

#### 1.1 待機画面で採点指示の二重遷移が起きない
- 主任が1回promptを発行した際、一般検定員が1回だけ採点画面に遷移することを確認
- **検証項目**: URL変化回数 = 1回、正しいbibパラメータ、3秒待機後も追加遷移なし

#### 1.2 待機画面で複数promptが連続発行されても正しく遷移する
- 複数のpromptが連続発行された場合でも、各promptで1回ずつ正しく遷移すること
- **検証項目**: 各promptで1回遷移、正しいパラメータ

#### 1.3 待機画面でセッション終了時は終了画面へ遷移する
- セッション終了時に採点画面ではなく終了画面に遷移すること
- **検証項目**: URL変化回数 = 1回、`ended=true`パラメータ、終了メッセージ表示

#### 1.4 Realtimeとポーリングの同時動作で二重遷移が起きない
- RealtimeとPollingフォールバックが両方動作しても、previousPromptIdで二重遷移を防ぐこと
- **検証項目**: URL変化回数 = 1回（検知回数に関わらず）、5秒待機後も追加遷移なし

### 実行方法

#### 前提条件

1. **Playwrightのインストール**:
```bash
npx playwright install
```

2. **環境変数の設定** (`.env.test`):
```bash
# テストユーザーのクレデンシャル
TEST_CHIEF_EMAIL=chief@example.com
TEST_CHIEF_PASSWORD=password
TEST_JUDGE1_EMAIL=judge1@example.com
TEST_JUDGE1_PASSWORD=password
TEST_JUDGE2_EMAIL=judge2@example.com
TEST_JUDGE2_PASSWORD=password

# ベースURL（オプション）
BASE_URL=http://localhost:5173
```

3. **開発サーバーの起動**:
```bash
npm run dev
```

#### テスト実行

```bash
# すべてのE2Eテストを実行
npm run test:e2e

# UIモードで実行（デバッグに便利）
npm run test:e2e:ui

# 特定のテストのみ実行
npx playwright test -g "待機画面で採点指示の二重遷移が起きない"
```

### トラブルシューティング

#### 二重遷移の検証方法

テストでは以下の方法で二重遷移を検出します：

1. **URL変化のカウント**:
```typescript
page.on('framenavigated', (frame) => {
  if (frame === page.mainFrame()) {
    urlChanges.push(frame.url());
  }
});
```

2. **待機時間の挿入**:
```typescript
await page.waitForURL('**/score/input**', { timeout: 5000 });
await page.waitForTimeout(3000); // 追加遷移がないことを確認
```

#### 成功パターン

```
[初期状態] Judge1 URLs: 1, Judge2 URLs: 1
✅ 主任検定員が採点指示を発行: bib=10
[遷移回数] Judge1: 1回, Judge2: 1回
✅ 同一promptで二重遷移は発生しなかった
```

---

## 2. Stripe統合機能テスト

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
