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

## 大会チケット（スポット販売）の手動検証（2026-07-30 追加）

前提: dev DB に migration 1022/1023 適用済み。詳細な SQL は `database/migrations/verify/1022_verify_tournament_tickets.sql`。

- [ ] チケット 0 枚の組織で大会モードを選択 → 作成画面に「お問い合わせ」案内が表示される
- [ ] そのまま作成を試行 → 403「大会モードのご利用には大会チケットが必要です…」+ お見積りボタン
- [ ] SQL Editor でチケットを1枚付与 → 作成画面に「大会チケット残数: 1枚」表示
- [ ] 大会セッション作成成功 → tournament_tickets の used_at / session_id がセットされる
- [ ] 残 0 で再作成 → 再び 403（DB トリガーでも拒否されること）
- [ ] 検定・研修モードはチケット無しで従来どおり作成できる
- [ ] Free 組織 + チケットで、検定員 4 人目がセッション参加できる（大会は上限免除）
- [ ] Free 組織で大会作成が月間 3 セッションのカウントを消費しない（account ページ表示も確認）
- [ ] PostgREST 直叩きで mode='tournament' の INSERT / 既存セッションの大会化 UPDATE が拒否される
- [ ] /contact?category=tournament_quote で種別がプリセットされ、送信・通知メールに「大会利用のお見積り」が出る

---

## オフライン採点（ローカル保存ファースト）の手動検証（2026-08-01 追加）

前提: dev DB に migration 1024 適用済み。設計は `docs/architecture/network-resilience-strategy.md`。
機内モードの切替は DevTools の Network → Offline でも可（実機 iOS 推奨）。

### オンライン時（従来動作の非回帰）
- [ ] 検定モードで採点送信 → 従来どおり完了/待機画面へ遷移。バッジ類は何も表示されない
- [ ] 大会/研修モード（input 画面）で採点送信 → 同上
- [ ] サーバーが検証拒否するケース（例: 範囲外は UI で防がれるため、締切済みセッション等）→ 従来どおりエラー表示され、未同期件数が増えない

### オフライン時（新規動作）
- [ ] 機内モードにして採点送信 → 「端末に保存済みです。通信が復帰すると自動同期されます。」+「オフライン」バッジ表示。alert は出ない
- [ ] そのまま複数件採点 → 「未同期 N件」が増えていく
- [ ] 機内モード解除 → 30秒以内（または online イベントで即時）に自動同期され、未同期 0 件・バッジ非表示に戻る
- [ ] 同期後、セッション結果画面/エクスポートに全採点が正しい点数で存在する（重複なし）
- [ ] 同期前にページを再読み込み・アプリ再起動しても未同期データが残っている（IndexedDB 永続性）
- [ ] 複数検定員モード: オフライン採点→復帰同期後、status 画面の全員分の点数が揃う
- [ ] ゲスト検定員（?guest= 付き URL）でオフライン採点→復帰同期が成功する
  - 既知の制約: ゲストの匿名 JWT が失効していると同期は auth_required で保留され続ける（端末保存は維持・「未同期」表示。再認証フローはインクリメント3以降）
- [ ] 一時的なサーバーエラー（5xx/401）で採点送信が失敗しても「未同期」としてキューに残り、後で自動同期される（キューから消えないこと）
- [ ] オフラインで同じゼッケンを採点し直す → 未同期は最新の1件だけになり、復帰同期後の点数が最後の入力値になる（古い点数への巻き戻りが起きないこと）
- [ ] 採点画面を離れて（ダッシュボード等に居る状態で）回線が復帰しても、pending の採点が自動同期される

### 事前ダウンロード + オフライン継続採点（2026-08-02 追加）
- [ ] セッション入口ページに「オフライン利用の準備」カードが表示され、オンラインで自動的に「保存済み（時刻 / 参加者N名）」になる
- [ ] 「今すぐ更新」で保存時刻が更新される。オフライン時は「更新できませんでした」表示
- [ ] 検定・単独: オフラインで採点 → 「次の選手を採点する」→ 任意のゼッケン入力 → 続けて採点できる。復帰後、全選手分が同期される（未登録ゼッケンは 選手N として自動作成）
- [ ] 研修・単独: 同上。ただし未登録ゼッケンは「事前に登録済みのゼッケンのみ採点できます」と拒否される
- [ ] 多審制セッション（検定multi/大会）では「次の選手を採点する」ボタンが表示されない
- [ ] 継続採点時、前の選手の入力点数が画面に残っていない（キーパッドがクリアされている）
- [ ] 継続採点後にオンライン復帰し、その画面のまま採点送信 → 正しい bib で保存される

### iOS 固有
- [ ] iOS Safari（未インストール）で採点画面に「ホーム画面に追加」案内が表示され、× で以後表示されない
- [ ] ホーム画面追加後の起動（standalone）では案内が表示されない

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
