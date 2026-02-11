# Stripe E2E統合テスト チェックリスト

このチェックリストを使用して、E2E統合テストを体系的に実施してください。

## テスト実施日時

- **実施日**: _______________
- **実施者**: _______________
- **環境**: [ ] Local Dev [ ] Staging
- **Stripe Mode**: [ ] Test Mode

---

## 事前準備

- [ ] Stripe CLIがインストール済み（`stripe --version`）
- [ ] Stripe Test Mode APIキーが`.env`に設定済み
- [ ] Supabaseがアクセス可能
- [ ] テスト用ユーザーアカウントを準備
- [ ] `./tests/e2e/run-e2e-test.sh`を実行して前提条件を確認

---

## シナリオ1: 個人課金の新規サブスクリプション

### 目的
API → Webhook → DB更新の完全な経路を検証

### 手順

#### 1. 環境セットアップ

- [ ] ターミナル1: `stripe listen --forward-to localhost:5173/api/stripe/webhook`を実行
- [ ] Webhook Signing Secretを`.env`に設定
- [ ] ターミナル2: `npm run dev`を実行
- [ ] ブラウザでログイン（テストユーザー）

#### 2. 初期状態の記録

- [ ] Supabase Studioで現在の`subscriptions`レコードを確認
- [ ] 現在の`plan_type`: _______________
- [ ] 現在の`stripe_subscription_id`: _______________

#### 3. Checkoutフロー

- [ ] `http://localhost:5173/pricing`へアクセス
- [ ] 「Standard プラン」の「月額プランを選択」をクリック
- [ ] Stripe Checkoutページへ遷移することを確認
- [ ] テストカード情報を入力:
  - カード番号: 4242 4242 4242 4242
  - 有効期限: 12/34
  - CVC: 123
  - 郵便番号: 12345
- [ ] 「支払う」をクリック
- [ ] 成功ページへリダイレクトされることを確認

#### 4. Webhook受信確認

Stripe CLIのターミナルで以下のログを確認:

- [ ] `[Webhook] イベント受信: checkout.session.completed`
- [ ] `[Webhook] Checkout完了: cs_xxxxx`
- [ ] `[Webhook] Price ID: ... → プランタイプ: standard`
- [ ] `[Webhook] subscriptions更新成功: ... standard`
- [ ] エラーログが出ていないことを確認

#### 5. DB検証

Supabase Studioで以下のクエリを実行:

```sql
SELECT * FROM subscriptions WHERE user_id = '<TEST_USER_ID>';
```

- [ ] `plan_type` = 'standard'
- [ ] `billing_interval` = 'month'
- [ ] `status` = 'active'
- [ ] `stripe_customer_id`が設定されている（'cus_xxxxx'）
- [ ] `stripe_subscription_id`が設定されている（'sub_xxxxx'）
- [ ] `current_period_start`と`current_period_end`が設定されている
- [ ] `cancel_at_period_end` = false
- [ ] `organization_id` = NULL

#### 6. Stripe Dashboard確認

[Stripe Dashboard（Test Mode）](https://dashboard.stripe.com/test/subscriptions)で確認:

- [ ] 新規サブスクリプションが表示されている
- [ ] ステータスが「Active」
- [ ] Customer情報が正しい
- [ ] メタデータに`user_id`が設定されている

### 結果

- [ ] ✅ 合格
- [ ] ❌ 不合格（理由: _______________）

---

## シナリオ2: 組織課金の新規サブスクリプション

### 目的
組織作成フローでの複数テーブル更新を検証

### 手順

#### 1. 組織作成

- [ ] `http://localhost:5173/organizations/new`へアクセス
- [ ] 組織名を入力（例: "Test Organization E2E"）
- [ ] 「作成」をクリック
- [ ] 組織ID（URL）をメモ: _______________

#### 2. Checkoutフロー

- [ ] 組織の設定ページへ移動: `/organizations/[org-id]/settings/billing`
- [ ] 「Basic プラン」の「月額プランを選択」をクリック
- [ ] Stripe Checkoutページへ遷移
- [ ] テストカード情報を入力（上記と同じ）
- [ ] 決済を完了
- [ ] 成功ページへリダイレクトされることを確認

#### 3. Webhook受信確認

- [ ] `[Webhook] イベント受信: checkout.session.completed`
- [ ] `[Webhook] Metadata: { ... is_organization: 'true' }`
- [ ] `[Webhook] 組織作成: ...`または`[Webhook] organizations更新成功`
- [ ] `[Webhook] subscriptions更新成功: ... basic`
- [ ] エラーログが出ていないことを確認

#### 4. DB検証

**organizationsテーブル:**

```sql
SELECT * FROM organizations WHERE id = '<TEST_ORG_ID>';
```

- [ ] `plan_type` = 'basic'
- [ ] `max_members` = 10
- [ ] `stripe_customer_id`が設定されている
- [ ] `stripe_subscription_id`が設定されている

**organization_membersテーブル:**

```sql
SELECT * FROM organization_members WHERE organization_id = '<TEST_ORG_ID>';
```

- [ ] 作成者が`role` = 'admin'で登録されている

**subscriptionsテーブル:**

```sql
SELECT * FROM subscriptions WHERE organization_id = '<TEST_ORG_ID>';
```

- [ ] `organization_id`が設定されている
- [ ] `plan_type` = 'basic'
- [ ] `status` = 'active'
- [ ] `stripe_subscription_id`が設定されている

#### 5. Stripe Dashboard確認

- [ ] 新規サブスクリプションが表示されている
- [ ] メタデータに`organization_id`と`organization_name`が設定されている

### 結果

- [ ] ✅ 合格
- [ ] ❌ 不合格（理由: _______________）

---

## シナリオ3: サブスクリプションキャンセル

### 目的
サブスクリプション削除イベントの処理を検証

### 手順

#### 1. Customer Portalへアクセス

- [ ] `http://localhost:5173/settings/billing`へアクセス
- [ ] 「プランを管理」をクリック
- [ ] Stripe Customer Portalへ遷移することを確認

#### 2. キャンセル実行

- [ ] 「サブスクリプションをキャンセル」をクリック
- [ ] 確認ダイアログで「キャンセルを確定」をクリック
- [ ] キャンセル完了メッセージを確認

#### 3. Webhook受信確認

- [ ] `[Webhook] イベント受信: customer.subscription.deleted`
- [ ] `[Webhook] Subscriptionキャンセル: sub_xxxxx`
- [ ] `[Webhook] subscriptionsをフリープランに降格`
- [ ] エラーログが出ていないことを確認

#### 4. DB検証

```sql
SELECT * FROM subscriptions WHERE user_id = '<TEST_USER_ID>';
```

- [ ] `plan_type` = 'free'
- [ ] `status` = 'canceled'
- [ ] `stripe_subscription_id` = NULL
- [ ] `cancel_at_period_end` = NULL

#### 5. Stripe Dashboard確認

- [ ] サブスクリプションのステータスが「Canceled」

### 結果

- [ ] ✅ 合格
- [ ] ❌ 不合格（理由: _______________）

---

## データ整合性チェック

以下のSQLクエリを実行して、データ整合性を確認:

```sql
-- 孤立したサブスクリプション
SELECT s.* FROM subscriptions s
LEFT JOIN auth.users u ON s.user_id = u.id
WHERE u.id IS NULL;
```

- [ ] 結果: 0件

```sql
-- 組織とサブスクリプションのプラン不一致
SELECT o.id, o.plan_type AS org_plan, s.plan_type AS sub_plan
FROM organizations o
LEFT JOIN subscriptions s ON o.id = s.organization_id
WHERE o.plan_type != s.plan_type;
```

- [ ] 結果: 0件

---

## 全体結果

### 合格基準

- すべてのシナリオが✅合格
- データ整合性チェックで問題なし
- エラーログが記録されていない

### テスト結果

- [ ] ✅ 全テスト合格
- [ ] ⚠️  一部失敗（詳細: _______________）
- [ ] ❌ 重大な問題あり（詳細: _______________）

### 次のアクション

- [ ] 問題なし - テスト完了
- [ ] 問題あり - 修正チケットを作成（チケット番号: _______________）
- [ ] 再テストが必要

---

## 備考・メモ

テスト中に気づいた点や問題点を記録:

```
（メモ欄）






```

---

## 承認

- **テスト完了日**: _______________
- **承認者**: _______________
- **署名**: _______________
