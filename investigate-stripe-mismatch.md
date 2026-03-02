# Stripe Subscription ID不一致の調査

## 現状
- **subscriptions テーブル**: 正しく更新済み（free, canceled）
- **organizations テーブル**: 更新されていない（premium のまま）
- **organizations.stripe_subscription_id**: sub_1SRi4xIsuW568CJsOPocxGAY

## 問題
webhook の `handleSubscriptionDeleted` で、以下の条件が false になった:
```typescript
if (currentOrg?.stripe_subscription_id === subscription.id)
```

つまり、Stripeから送られてきた削除イベントのサブスクリプションIDが 'sub_1SRi4xIsuW568CJsOPocxGAY' ではなかった。

## 考えられる原因

### 1. プラン変更時の古いサブスクリプション削除
- ユーザーがプランをアップグレード/ダウングレードした
- Stripeが新しいサブスクリプションを作成し、古いサブスクリプションを削除
- 削除イベントは古いサブスクリプションIDで送られてくる
- 組織は新しいサブスクリプションIDを保持しているため、条件が一致しない

### 2. 手動でのStripe操作
- Stripe Dashboardで直接サブスクリプションを削除した
- 削除したサブスクリプションIDが、アプリケーションが保存しているIDと異なっていた

### 3. Webhook受信の順序問題
- 複数のwebhookイベントが短時間に発生
- 処理順序によって不整合が発生

## 調査手順

### 1. Stripe Dashboardで確認
1. https://dashboard.stripe.com/test/subscriptions にアクセス
2. Customer IDで検索: `uddystyle@gmail.com` または組織のStripe Customer ID
3. サブスクリプション履歴を確認:
   - 'sub_1SRi4xIsuW568CJsOPocxGAY' の状態は？
   - 他に削除されたサブスクリプションがあるか？

### 2. Webhook ログを確認
1. https://dashboard.stripe.com/test/webhooks にアクセス
2. 最近のイベントログを確認:
   - `customer.subscription.deleted` イベントを探す
   - どのサブスクリプションIDで送信されたか確認

### 3. アプリケーションログを確認
削除時のログを探す:
```
[Webhook] イベント受信: customer.subscription.deleted
[Webhook] Subscriptionキャンセル: sub_xxxxx
```

## 修正案

### 短期対応（済み）
手動でorganizationsテーブルを修正

### 中長期対応
webhook処理を改善:

**オプション1**: stripe_subscription_id による完全一致ではなく、customer_id でマッチング
**オプション2**: subscription.metadata に organization_id を保存し、それを使用
**オプション3**: すべての削除イベントで組織をチェックし、該当する組織があればフリープランに降格

## 次のステップ
1. 上記の手動SQL修正を実行
2. Stripe Dashboardでサブスクリプション履歴を確認
3. 根本原因に応じてwebhook処理を改善
