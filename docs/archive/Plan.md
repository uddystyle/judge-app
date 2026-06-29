# TENTO マネタイズ実装計画

> **⚠️ 注意**: このドキュメントは古い実装プランです。
> 個人プラン関連のAPI (`/api/stripe/create-checkout-session`) は削除されました (2026-03-10)。
> 現在は組織ベースプランのみをサポートしています。

## 💰 料金プラン

### プラン構成

**1. フリープラン（無料）**

- 月間3セッションまで
- 選手数: 30名まで/セッション
- 検定員: 5名まで/セッション
- 基本的な採点機能
- CSV エクスポート
- 検定モードのみ

**2. スタンダードプラン**

- **月額: ¥980/月**
- **年額: ¥9,800/年（2ヶ月分お得！）**
- 月間無制限セッション
- 選手数: 100名まで/セッション
- 検定員: 20名まで/セッション
- 検定モード + 大会モード
- スコアボード公開機能
- メールサポート
- データ保存期間: 1年

**3. プロプラン**

- **月額: ¥2,980/月**
- **年額: ¥29,800/年（約6ヶ月分お得！）**
- すべてのスタンダード機能
- 選手数: 無制限
- 検定員: 無制限
- データ保存期間: 無制限
- 優先メールサポート

### 価格比較表

| プラン       | 月額   | 年額    | 年間割引額                  |
| ------------ | ------ | ------- | --------------------------- |
| スタンダード | ¥980   | ¥9,800  | ¥1,960お得（2ヶ月分無料）   |
| プロ         | ¥2,980 | ¥29,800 | ¥5,960お得（約2ヶ月分無料） |

### 機能比較表

| 項目                | フリー | スタンダード | プロ       |
| ------------------- | ------ | ------------ | ---------- |
| 月間セッション数    | 3      | 無制限       | 無制限     |
| 選手数/セッション   | 30名   | 100名        | **無制限** |
| 検定員数/セッション | 5名    | 20名         | **無制限** |
| 大会モード          | ✗      | ✓            | ✓          |
| 研修モード          | ✗      | ✓            | ✓          |
| スコアボード        | ✗      | ✓            | ✓          |
| データ保存期間      | 3ヶ月  | 1年          | **無制限** |

### 想定ユーザー

- **フリー**: 個人の検定員、小規模なクラブ
- **スタンダード**: スキースクール、地域の大会運営者
- **プロ**: 大規模な大会主催者、長期的なデータ管理が必要な組織

---

## 🏗️ Stripe実装の全体アーキテクチャ

```
┌─────────────────────────────────────────────────────────────┐
│                        フロントエンド                          │
├─────────────────────────────────────────────────────────────┤
│  /pricing                料金プラン表示                        │
│  /account                現在のプラン・使用状況表示             │
│  /account/billing        請求履歴・カード変更                  │
└──────────────────┬──────────────────────────────────────────┘
                   │
                   ↓ API呼び出し
┌─────────────────────────────────────────────────────────────┐
│                    バックエンド API                            │
├─────────────────────────────────────────────────────────────┤
│  POST /api/stripe/create-checkout-session                    │
│    → Stripe Checkoutセッション作成                            │
│                                                               │
│  POST /api/stripe/create-portal-session                      │
│    → Stripe Customer Portalセッション作成                     │
│                                                               │
│  POST /api/stripe/webhook                                    │
│    → Stripeからのイベント処理                                 │
└──────────────────┬──────────────────────────────────────────┘
                   │
                   ↓ Stripe API呼び出し
┌─────────────────────────────────────────────────────────────┐
│                         Stripe                               │
├─────────────────────────────────────────────────────────────┤
│  • Checkout Session (決済画面)                               │
│  • Customer Portal (サブスク管理画面)                         │
│  • Webhooks (イベント通知)                                    │
│  • Subscriptions (サブスク管理)                               │
└──────────────────┬──────────────────────────────────────────┘
                   │
                   ↓ Webhook通知
┌─────────────────────────────────────────────────────────────┐
│                      Supabase DB                             │
├─────────────────────────────────────────────────────────────┤
│  subscriptions          ユーザーのサブスク情報                │
│  usage_limits           使用状況の追跡                        │
│  plan_limits            プラン制限の定義                      │
└─────────────────────────────────────────────────────────────┘
```

---

## 📋 詳細な実装フロー

### 1️⃣ ユーザーがプランを選択する流れ

```
[ユーザー]
    ↓ /pricing ページでプランを選択
[料金ページ]
    ↓ 「アップグレード」ボタンクリック
[フロントエンド]
    ↓ POST /api/stripe/create-checkout-session
[バックエンドAPI]
    ↓ 1. ユーザー認証確認
    ↓ 2. Stripe Customer作成/取得
    ↓ 3. Stripe Checkout Session作成
    ↓ 4. Checkout URLを返す
[フロントエンド]
    ↓ Stripe Checkoutページにリダイレクト
[Stripe Checkout]
    ↓ ユーザーがカード情報入力・決済
    ↓ 成功時: /account/success にリダイレクト
[Stripe]
    ↓ webhook: checkout.session.completed イベント送信
[バックエンドAPI: Webhook]
    ↓ 1. イベント検証
    ↓ 2. subscriptionsテーブルに登録
    ↓ 3. プラン情報更新
[完了]
```

### 2️⃣ サブスク管理の流れ

```
[ユーザー]
    ↓ /account ページで「プラン管理」クリック
[アカウントページ]
    ↓ POST /api/stripe/create-portal-session
[バックエンドAPI]
    ↓ 1. Stripe Customer ID取得
    ↓ 2. Customer Portal Session作成
    ↓ 3. Portal URLを返す
[フロントエンド]
    ↓ Stripe Customer Portalにリダイレクト
[Stripe Portal]
    ↓ プラン変更・キャンセル・カード更新
[Stripe]
    ↓ webhook: customer.subscription.* イベント送信
[バックエンドAPI: Webhook]
    ↓ subscriptionsテーブル更新
[完了]
```

### 3️⃣ 制限チェックの流れ

```
[ユーザー]
    ↓ セッション作成ボタンクリック
[フロントエンド]
    ↓ POST /session/create
[バックエンドAPI]
    ↓ 1. ユーザーのプラン取得 (subscriptionsテーブル)
    ↓ 2. 今月のセッション数カウント (usage_limitsテーブル)
    ↓ 3. プラン制限と比較 (plan_limitsテーブル)
    ↓ 4-a. OK → セッション作成
    ↓ 4-b. NG → エラー「制限に達しました」
[完了]
```

---

## 🗄️ データベース設計

### subscriptions テーブル

ユーザーのサブスクリプション情報を管理

```sql
CREATE TABLE subscriptions (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,

  -- Stripe関連
  stripe_customer_id TEXT UNIQUE NOT NULL,
  stripe_subscription_id TEXT UNIQUE,

  -- プラン情報
  plan_type TEXT NOT NULL CHECK (plan_type IN ('free', 'standard', 'pro')),
  billing_interval TEXT NOT NULL CHECK (billing_interval IN ('month', 'year')),

  -- ステータス
  status TEXT NOT NULL CHECK (status IN ('active', 'canceled', 'past_due', 'unpaid')),

  -- 期間
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  cancel_at_period_end BOOLEAN DEFAULT FALSE,

  -- タイムスタンプ
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(user_id)
);

-- RLS設定
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own subscription"
  ON subscriptions FOR SELECT
  USING (auth.uid() = user_id);
```

### plan_limits テーブル

各プランの制限値を定義

```sql
CREATE TABLE plan_limits (
  plan_type TEXT PRIMARY KEY,
  max_sessions_per_month INTEGER, -- -1 = unlimited
  max_athletes_per_session INTEGER,
  max_judges_per_session INTEGER,
  has_tournament_mode BOOLEAN DEFAULT FALSE,
  has_training_mode BOOLEAN DEFAULT FALSE,
  has_scoreboard BOOLEAN DEFAULT FALSE,
  data_retention_months INTEGER -- -1 = unlimited
);

INSERT INTO plan_limits VALUES
  ('free', 3, 30, 5, false, false, false, 3),
  ('standard', -1, 100, 20, true, true, true, 12),
  ('pro', -1, -1, -1, true, true, true, -1);
```

### usage_limits テーブル

月ごとの使用状況を追跡

```sql
CREATE TABLE usage_limits (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  month DATE NOT NULL, -- 'YYYY-MM-01' 形式
  sessions_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, month)
);

-- RLS設定
ALTER TABLE usage_limits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own usage"
  ON usage_limits FOR SELECT
  USING (auth.uid() = user_id);
```

---

## 🔐 Stripe Webhook イベント処理

### 処理するイベント一覧

#### 1. checkout.session.completed

- **タイミング**: 新規サブスク登録成功時
- **処理内容**: `subscriptions`テーブルに新規レコード作成

#### 2. customer.subscription.created

- **タイミング**: サブスク作成時（checkoutの後に来る）
- **処理内容**: 必要に応じてレコード更新

#### 3. customer.subscription.updated

- **タイミング**: プラン変更時（standard → pro など）
- **処理内容**: `plan_type`, `billing_interval`を更新

#### 4. customer.subscription.deleted

- **タイミング**: サブスクキャンセル時
- **処理内容**:
  - `status`を'canceled'に更新
  - `plan_type`を'free'に降格

#### 5. invoice.payment_succeeded

- **タイミング**: 更新時の支払い成功
- **処理内容**: `current_period_start`, `current_period_end`を更新

#### 6. invoice.payment_failed

- **タイミング**: 支払い失敗
- **処理内容**:
  - `status`を'past_due'に更新
  - ユーザーにメール通知

---

## 🔧 API エンドポイント詳細

### POST /api/stripe/create-checkout-session

Stripe Checkoutセッションを作成し、決済ページURLを返す

**リクエスト:**

```typescript
{
  priceId: string, // Stripe Price ID (例: price_xxxxx)
  successUrl: string, // 成功時のリダイレクトURL
  cancelUrl: string  // キャンセル時のリダイレクトURL
}
```

**レスポンス:**

```typescript
{
	url: string; // Stripe Checkout URL
}
```

**処理内容:**

1. ユーザー認証確認
2. Stripe Customer作成/取得
3. Checkout Session作成
4. URLを返す

---

### POST /api/stripe/create-portal-session

Stripe Customer Portalセッションを作成

**リクエスト:**

```typescript
{
	returnUrl: string; // Portal終了後のリダイレクトURL
}
```

**レスポンス:**

```typescript
{
	url: string; // Stripe Customer Portal URL
}
```

**処理内容:**

1. ユーザー認証確認
2. `subscriptions`からCustomer ID取得
3. Portal Session作成
4. URLを返す

---

### POST /api/stripe/webhook

Stripeからのwebhookイベントを受信・処理

**リクエスト:**

- Stripeからのwebhookイベント（署名付き）

**処理内容:**

1. Stripe署名検証
2. イベントタイプに応じて処理
3. データベース更新
4. 200 OKを返す

---

## 🎨 フロントエンド画面設計

### /pricing ページ

料金プラン比較とアップグレードボタン

```
┌─────────────────────────────────────────────┐
│              料金プラン                       │
├─────────────────────────────────────────────┤
│                                             │
│  [フリー]    [スタンダード]    [プロ]        │
│   ¥0         ¥980/月          ¥2,980/月    │
│              ¥9,800/年        ¥29,800/年   │
│                                             │
│  • 3セッション  • 無制限セッション  • 無制限  │
│  • 30選手      • 100選手         • 無制限  │
│  • 5検定員     • 20検定員        • 無制限  │
│                                             │
│              [アップグレード]  [アップグレード]│
└─────────────────────────────────────────────┘
```

### /account ページ

現在のプラン・使用状況・管理ボタン

```
┌─────────────────────────────────────────────┐
│            アカウント設定                      │
├─────────────────────────────────────────────┤
│                                             │
│  現在のプラン: スタンダード (月額)             │
│  次回更新日: 2025-12-01                      │
│                                             │
│  [プラン管理] [請求履歴]                      │
│                                             │
│  今月の使用状況:                              │
│  ━━━━━━━━━━ 5 / 無制限 セッション           │
│                                             │
└─────────────────────────────────────────────┘
```

---

## 🔒 セキュリティ対策

### 1. Webhook署名検証必須

- Stripeからのリクエストのみ受け付ける
- 署名が一致しない場合は403エラー

### 2. 環境変数の分離

- テストモード/本番モードのAPIキーを分ける
- `.env.local`にテスト用キー
- Vercelの環境変数に本番用キー

### 3. RLS (Row Level Security)

- ユーザーは自分のサブスク情報のみ参照可能
- auth.uid()を使用したポリシー設定

### 4. HTTPS必須

- Webhookは必ずHTTPSで受信
- ローカル開発時はStripe CLIを使用

---

## 📝 必要な環境変数

### 開発環境 (.env.local)

```env
# Stripe Test Mode
STRIPE_SECRET_KEY=sk_test_xxxxx
STRIPE_PUBLISHABLE_KEY=pk_test_xxxxx
STRIPE_WEBHOOK_SECRET=whsec_xxxxx
```

### 本番環境 (Vercel環境変数)

```env
# Stripe Live Mode
STRIPE_SECRET_KEY=sk_live_xxxxx
STRIPE_PUBLISHABLE_KEY=pk_live_xxxxx
STRIPE_WEBHOOK_SECRET=whsec_xxxxx
```

---

## 🗺️ 実装ロードマップ

### フェーズ1: 基盤構築（1-2週間）

#### 1.1 Stripe セットアップ

- [ ] Stripeアカウント作成
- [ ] テストモード/本番モードの環境変数設定
- [ ] Stripe CLI のセットアップ

#### 1.2 データベーススキーマ拡張

- [ ] `subscriptions` テーブル作成
- [ ] `plan_limits` テーブル作成
- [ ] `usage_limits` テーブル作成
- [ ] RLSポリシー設定

#### 1.3 バックエンド API構築

- [ ] `/api/stripe/create-checkout-session` 実装
- [ ] `/api/stripe/create-portal-session` 実装
- [ ] `/api/stripe/webhook` 実装

### フェーズ2: フロントエンド実装（1週間）

#### 2.1 料金ページ作成

- [ ] `/pricing` ページ作成
- [ ] プラン比較表の実装
- [ ] "アップグレード" ボタン実装

#### 2.2 アカウントページ拡張

- [ ] 現在のプラン表示
- [ ] 使用状況表示（セッション数など）
- [ ] プラン変更・キャンセルボタン

#### 2.3 制限チェック実装

- [ ] セッション作成時の制限チェック
- [ ] 参加者追加時の制限チェック
- [ ] 大会モードへのアクセス制限

### フェーズ3: Webhook & 同期（1週間）

#### 3.1 Stripe Webhook処理

- [ ] `checkout.session.completed` ハンドラー
- [ ] `customer.subscription.updated` ハンドラー
- [ ] `customer.subscription.deleted` ハンドラー
- [ ] `invoice.payment_succeeded` ハンドラー
- [ ] `invoice.payment_failed` ハンドラー

#### 3.2 自動更新処理

- [ ] サブスクステータス自動更新
- [ ] 期限切れ時の制限適用
- [ ] メール通知

### フェーズ4: テスト & 本番化（1週間）

#### 4.1 テスト

- [ ] Stripeテストモードでの決済フロー確認
- [ ] Webhook動作確認
- [ ] エラーハンドリング確認
- [ ] 制限機能のテスト

#### 4.2 本番デプロイ

- [ ] 本番Stripe APIキー設定
- [ ] 特定商取引法表示ページ
- [ ] プライバシーポリシー更新
- [ ] 利用規約作成

---

## 💾 データ保存コストの試算

### Supabaseのストレージコスト

**無料枠:**

- データベース容量: 500MB
- ストレージ: 1GB

**Pro プラン（$25/月 = 約¥3,500）:**

- データベース容量: 8GB
- ストレージ: 100GB
- 追加データベース容量: $0.125/GB/月

### TENTOのデータサイズ試算

1セッションあたりのデータ量：

- セッション情報: ~1KB
- 参加者（検定員）: ~0.5KB × 平均10名 = 5KB
- 選手情報: ~1KB × 平均50名 = 50KB
- 採点結果: ~0.5KB × 平均500件 = 250KB
- 大会の種目設定: ~2KB

**合計: 約300KB/セッション**

### 年間コスト試算

**プロプランユーザーが100名の場合:**

- 1ユーザーあたり年間50セッション想定
- データ量: 300KB × 50セッション × 100ユーザー = 1.5GB/年

**5年間のデータ蓄積:**

- 1.5GB × 5年 = 7.5GB
- Supabase Pro プラン内で収まる

**結論:**

- データコストは1ユーザーあたり月数円程度
- ¥2,980/月の価格設定で十分な利益率を確保可能

---

## 📞 サポート

### メールサポート

- スタンダード: 営業日48時間以内に返信
- プロ: 営業日24時間以内に返信（優先対応）

### サポート対象

- 使い方に関する質問
- トラブルシューティング
- 機能リクエスト
- バグレポート

---

## ⚠️ 実装時の重要な注意事項

### 🔴 最重要: テストモードから始める

**絶対にいきなり本番モードで始めないこと！**

- まずStripeのテストモードで全機能を実装・テスト
- テストカード番号を使用して決済フローを確認
- Webhookの動作を完全に検証してから本番化

---

### 💳 Stripeの注意点

#### 1. Webhook署名検証は必須

**❌ 悪い例: 署名検証なし**

```typescript
const event = request.body;
```

**✅ 良い例: 署名検証あり**

```typescript
const signature = request.headers['stripe-signature'];
const event = stripe.webhooks.constructEvent(request.body, signature, webhookSecret);
```

**理由**: 署名検証がないと、悪意のあるリクエストでデータベースを改ざんされる可能性があります。

#### 2. Webhookのべき等性を保証

```typescript
// ✅ 同じイベントが複数回送られても安全
const existingSubscription = await supabase
	.from('subscriptions')
	.select()
	.eq('stripe_subscription_id', subscriptionId)
	.single();

if (existingSubscription) {
	// 既に処理済み → スキップ
	return { received: true };
}
```

**理由**: Stripeは同じwebhookイベントを複数回送信することがあります。

#### 3. Webhook URLはHTTPS必須

- **ローカル開発**: `stripe listen --forward-to localhost:5173/api/stripe/webhook`
- **本番**: `https://your-domain.com/api/stripe/webhook`

**理由**: HTTPではStripeがWebhookを送信できません。

#### 4. Customer IDの管理

```typescript
// ✅ 一度作成したら再利用
let customerId = user.stripe_customer_id;

if (!customerId) {
	const customer = await stripe.customers.create({
		email: user.email,
		metadata: { user_id: user.id }
	});
	customerId = customer.id;

	// DBに保存
	await supabase.from('subscriptions').upsert({ user_id: user.id, stripe_customer_id: customerId });
}
```

**理由**: 同じユーザーで複数のCustomerを作ると管理が複雑になります。

---

### 🗄️ データベースの注意点

#### 1. トランザクション処理

**❌ 危険: 途中で失敗すると不整合が発生**

```typescript
await supabase.from('subscriptions').update(...);
await supabase.from('usage_limits').insert(...);
```

**✅ 安全: RPCでトランザクション処理**

```typescript
await supabase.rpc('update_subscription_and_usage', { ... });
```

#### 2. RLS (Row Level Security)の設定ミス

**❌ 危険: 全ユーザーが他人のデータを見れる**

```sql
CREATE POLICY "Anyone can view subscriptions"
  ON subscriptions FOR SELECT
  USING (true);
```

**✅ 安全: 自分のデータのみ**

```sql
CREATE POLICY "Users can view own subscription"
  ON subscriptions FOR SELECT
  USING (auth.uid() = user_id);
```

#### 3. インデックスの設定

```sql
-- 頻繁に検索されるカラムにインデックス
CREATE INDEX idx_subscriptions_user_id ON subscriptions(user_id);
CREATE INDEX idx_subscriptions_stripe_customer_id ON subscriptions(stripe_customer_id);
CREATE INDEX idx_usage_limits_user_month ON usage_limits(user_id, month);
```

**理由**: インデックスがないとクエリが遅くなります。

---

### 🔐 セキュリティの注意点

#### 1. 環境変数の管理

**❌ 危険: フロントエンドでSecret Keyを使用**

```typescript
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY); // クライアントサイド
```

**✅ 安全: サーバーサイドのみでSecret Key使用**

```typescript
// +page.server.ts または api/+server.ts のみ
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
```

#### 2. Price IDのハードコーディング

**❌ 保守性が低い**

```typescript
if (plan === 'standard') {
	priceId = 'price_abc123';
}
```

**✅ 環境変数で管理**

```typescript
priceId = process.env[`STRIPE_PRICE_${plan.toUpperCase()}_${interval.toUpperCase()}`];
```

#### 3. ユーザー認証のチェック

**❌ 危険: 認証なしでAPI実行**

```typescript
export async function POST({ request }) {
	const { priceId } = await request.json();
	// ...
}
```

**✅ 安全: 必ず認証確認**

```typescript
export async function POST({ request, locals: { supabase } }) {
	const {
		data: { user },
		error
	} = await supabase.auth.getUser();

	if (error || !user) {
		throw error(401, '認証が必要です');
	}
	// ...
}
```

---

### 🎯 ビジネスロジックの注意点

#### 1. プラン制限のチェックタイミング

```typescript
// ✅ セッション作成前に必ずチェック
export const actions = {
	create: async ({ request, locals: { supabase } }) => {
		const user = await getUser();

		// 1. 現在のプラン取得
		const { plan_type } = await getSubscription(user.id);

		// 2. 制限チェック
		const canCreate = await checkSessionLimit(user.id, plan_type);

		if (!canCreate) {
			return fail(403, {
				error: '月間セッション数の上限に達しています。プランをアップグレードしてください。'
			});
		}

		// 3. セッション作成
		await createSession();
	}
};
```

#### 2. グレースピリオドの考慮

```typescript
// 支払い失敗後も数日間は使用可能にする
const isActive =
	subscription.status === 'active' ||
	(subscription.status === 'past_due' && daysSince(subscription.current_period_end) < 3);
```

#### 3. プランダウングレード時の処理

```typescript
// Pro → Standard: 既存の大規模セッションはどうする？
if (newPlan === 'standard' && oldPlan === 'pro') {
	const largeSessions = await getSessionsOverLimit(userId, 100);

	if (largeSessions.length > 0) {
		// 警告を表示
		return fail(400, {
			error: '100名を超えるセッションが存在します。削除またはプロプランを維持してください。'
		});
	}
}
```

---

### 📱 UXの注意点

#### 1. ローディング状態の管理

```svelte
<script>
	let loading = false;

	async function handleUpgrade() {
		loading = true;
		try {
			const response = await fetch('/api/stripe/create-checkout-session', {
				method: 'POST',
				body: JSON.stringify({ priceId })
			});
			const { url } = await response.json();
			window.location.href = url;
		} catch (error) {
			alert('エラーが発生しました');
		} finally {
			loading = false;
		}
	}
</script>

<button on:click={handleUpgrade} disabled={loading}>
	{loading ? '処理中...' : 'アップグレード'}
</button>
```

#### 2. エラーメッセージの表示

**❌ 技術的なエラーをそのまま表示**

```typescript
throw error(500, stripeError.message);
```

**✅ ユーザーフレンドリーなメッセージ**

```typescript
throw error(500, '決済処理中にエラーが発生しました。もう一度お試しください。');
```

#### 3. リダイレクト後の状態管理

```svelte
<!-- /account/success -->
<script>
	import { onMount } from 'svelte';

	onMount(() => {
		// Webhookが処理されるまで少し待つ
		setTimeout(() => {
			window.location.href = '/account';
		}, 2000);
	});
</script>

<div>
	<h1>アップグレード完了！</h1>
	<p>アカウントページにリダイレクトします...</p>
</div>
```

---

### 🧪 テストの注意点

#### 1. テストカードの使用

```
成功: 4242 4242 4242 4242
失敗: 4000 0000 0000 0002
3Dセキュア: 4000 0025 0000 3155
```

有効期限: 将来の任意の日付
CVC: 任意の3桁

#### 2. Webhook テスト

```bash
# Stripe CLIでローカルテスト
stripe listen --forward-to localhost:5173/api/stripe/webhook

# イベントを手動送信
stripe trigger checkout.session.completed
stripe trigger customer.subscription.updated
stripe trigger invoice.payment_failed
```

#### 3. エッジケースのテスト

- [ ] 支払い失敗時の挙動
- [ ] プラン変更中のセッション作成
- [ ] 同時リクエスト（競合状態）
- [ ] Webhook遅延時の挙動
- [ ] ネットワークエラー時の再試行
- [ ] 期限切れ直後のアクセス

---

### 💰 価格設定の注意点

#### 1. Stripe手数料を考慮

**日本の手数料: 3.6% + ¥0**

例: ¥980/月の場合

- Stripe手数料: ¥36 (¥980 × 3.6% + ¥0)
- 実質収益: ¥944

例: ¥2,980/月の場合

- Stripe手数料: ¥108
- 実質収益: ¥2,872

#### 2. 税金の処理

```typescript
// Stripe Tax を使用する場合（日本の消費税）
const session = await stripe.checkout.sessions.create({
	automatic_tax: { enabled: true }
	// ...
});
```

**注意**: 事業者登録が必要な場合があります。

---

### 📝 法的対応の注意点

#### 必要なページ

**1. 特定商取引法に基づく表記**

- 事業者名
- 代表者名
- 住所
- 連絡先（電話番号・メールアドレス）
- 販売価格
- 支払方法
- 支払時期
- サービス提供時期
- 返金・キャンセルポリシー

**2. 利用規約**

- サービス内容の定義
- 料金と支払い
- 無料トライアル（該当する場合）
- プラン変更・キャンセル
- 返金ポリシー
- 禁止事項
- 免責事項
- 準拠法

**3. プライバシーポリシー**

- 個人情報の取り扱い
- Stripeへのデータ提供について
- クッキーの使用
- データの保存期間
- お問い合わせ先

#### 返金ポリシーの例

```
返金について:
- 月額プランは日割り返金なし
- 年額プランは未使用月数分を日割り計算で返金
- キャンセル後も現在の請求期間終了まで使用可能
- システム障害による長期間の利用不可は全額返金
```

---

### 🚀 実装開始前のチェックリスト

#### 準備

- [ ] Stripeアカウント作成（テストモード）
- [ ] Stripe CLIインストール (`brew install stripe/stripe-cli/stripe`)
- [ ] 環境変数の準備（.env.local）
- [ ] データベースのバックアップ
- [ ] Plan.mdの確認

#### 法的ドキュメント

- [ ] 特定商取引法ページのドラフト作成
- [ ] 利用規約のドラフト作成
- [ ] プライバシーポリシーの更新
- [ ] 返金ポリシーの決定

#### テスト計画

- [ ] テストカードで決済フローの確認計画
- [ ] Webhook動作確認の手順書
- [ ] エラーケースのテストシナリオ
- [ ] 本番デプロイ前のチェックリスト

#### Stripe設定

- [ ] 商品（Product）の作成
- [ ] 価格（Price）の作成（月額4種、年額2種）
- [ ] Webhook エンドポイントの登録
- [ ] Customer Portalの設定

---

### 🔍 デバッグのヒント

#### 1. Webhook が届かない場合

**確認ポイント:**

- Webhook URLが正しいか
- HTTPSになっているか（本番）
- Stripe CLIが起動しているか（ローカル）
- Webhook署名シークレットが正しいか

**ログ確認:**

```bash
# Stripeダッシュボード > Developers > Webhooks > イベントログ
# 各イベントのレスポンスを確認
```

#### 2. サブスクが反映されない場合

**確認ポイント:**

- Webhookが正常に処理されたか
- データベースのRLSポリシーが正しいか
- `subscriptions`テーブルにレコードが作成されているか

**SQL確認:**

```sql
SELECT * FROM subscriptions WHERE user_id = 'xxx';
```

#### 3. 制限チェックが動作しない場合

**確認ポイント:**

- `plan_limits`テーブルにデータが入っているか
- プラン取得ロジックが正しいか
- フリープランユーザーのデフォルト設定

---

### 📊 モニタリング

#### 重要な指標

**ビジネス指標:**

- 新規サブスク数/月
- 解約率（Churn Rate）
- 平均顧客単価（ARPU）
- 顧客生涯価値（LTV）

**技術指標:**

- Webhook処理の成功率
- API応答時間
- エラー率
- データベースクエリパフォーマンス

#### アラート設定

- Webhook処理失敗率が5%を超えた場合
- 支払い失敗率が10%を超えた場合
- API応答時間が3秒を超えた場合

---

## 📚 参考リンク

- [Stripe公式ドキュメント](https://stripe.com/docs)
- [Stripe Checkout](https://stripe.com/docs/payments/checkout)
- [Stripe Customer Portal](https://stripe.com/docs/billing/subscriptions/integrating-customer-portal)
- [Stripe Webhooks](https://stripe.com/docs/webhooks)
- [Stripe Testing](https://stripe.com/docs/testing)
- [Supabase公式ドキュメント](https://supabase.com/docs)
- [特定商取引法ガイド](https://www.no-trouble.caa.go.jp/)
- [個人情報保護法ガイドライン](https://www.ppc.go.jp/)

---

