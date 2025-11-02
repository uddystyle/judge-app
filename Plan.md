# TENTO マネタイズ実装計画

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
  has_scoreboard BOOLEAN DEFAULT FALSE,
  data_retention_months INTEGER -- -1 = unlimited
);

INSERT INTO plan_limits VALUES
  ('free', 3, 30, 5, false, false, 3),
  ('standard', -1, 100, 20, true, true, 12),
  ('pro', -1, -1, -1, true, true, -1);
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

---

# 🎓 研修モード実装計画

## 概要

研修モードは、検定員の育成や評価のトレーニングを目的とした新機能です。大会モードと似た構造を持ちながら、以下の特徴を持ちます：

### 研修モードの特徴

| 項目 | 大会モード | 研修モード |
|------|-----------|-----------|
| 検定員数 | 3名 or 5名 | **最大100名** |
| 主任検定員 | 1名（セッション作成者） | **1名（明示的に設定）** |
| 採点方式 | 3審3採 / 5審3採（集計） | **個別表示（集計なし）** |
| スコアボード | 順位表示 | **検定員ごとの点数表**（マトリックス形式） |
| 種目設定 | 自由に設定可能 | **自由に設定可能** |
| 用途 | 公式大会 | 検定員研修・トレーニング |

### ユースケース

1. **検定員研修**: 新人検定員が経験者と同じ演技を採点し、結果を比較
2. **評価精度の確認**: 複数の検定員の採点傾向を分析
3. **トレーニングセッション**: 大規模な研修会で100名の検定員が同時に採点

---

## 🏗️ アーキテクチャ設計

### データベース拡張

#### 1. sessions テーブルに `mode` カラム追加

```sql
ALTER TABLE sessions
ADD COLUMN mode TEXT NOT NULL DEFAULT 'certification'
CHECK (mode IN ('certification', 'tournament', 'training'));

-- 既存データを更新
UPDATE sessions SET mode = 'tournament' WHERE is_competition = true;
UPDATE sessions SET mode = 'certification' WHERE is_competition = false;

-- 既存の is_competition カラムは後方互換性のため残す
```

#### 2. training_sessions テーブル作成

研修モード固有の設定を管理

```sql
CREATE TABLE training_sessions (
  id BIGSERIAL PRIMARY KEY,
  session_id BIGINT REFERENCES sessions(id) ON DELETE CASCADE NOT NULL,

  -- 主任検定員
  chief_judge_id BIGINT REFERENCES participants(id) ON DELETE SET NULL,

  -- 表示設定
  show_individual_scores BOOLEAN DEFAULT TRUE,
  show_score_comparison BOOLEAN DEFAULT TRUE,
  show_deviation_analysis BOOLEAN DEFAULT FALSE,

  -- 制限
  max_judges INTEGER DEFAULT 100,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(session_id)
);

-- RLS設定
ALTER TABLE training_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own training sessions"
  ON training_sessions FOR ALL
  USING (
    session_id IN (
      SELECT id FROM sessions WHERE creator_id = auth.uid()
    )
  );
```

#### 3. training_events テーブル作成

研修モードの種目管理（大会モードの tournament_events と類似）

```sql
CREATE TABLE training_events (
  id BIGSERIAL PRIMARY KEY,
  session_id BIGINT REFERENCES sessions(id) ON DELETE CASCADE NOT NULL,

  -- 種目情報
  name TEXT NOT NULL,
  order_index INTEGER NOT NULL,

  -- 採点設定
  min_score DECIMAL DEFAULT 0,
  max_score DECIMAL DEFAULT 100,
  score_precision INTEGER DEFAULT 1, -- 小数点以下の桁数

  -- ステータス
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed')),

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- インデックス
CREATE INDEX idx_training_events_session ON training_events(session_id);
CREATE INDEX idx_training_events_order ON training_events(session_id, order_index);
```

#### 4. training_scores テーブル作成

研修モードの採点データ（個別表示用）

```sql
CREATE TABLE training_scores (
  id BIGSERIAL PRIMARY KEY,
  event_id BIGINT REFERENCES training_events(id) ON DELETE CASCADE NOT NULL,
  judge_id BIGINT REFERENCES participants(id) ON DELETE CASCADE NOT NULL,
  athlete_id BIGINT REFERENCES participants(id) ON DELETE CASCADE NOT NULL,

  -- 採点
  score DECIMAL NOT NULL,
  is_finalized BOOLEAN DEFAULT FALSE,

  -- メモ機能（オプション）
  note TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(event_id, judge_id, athlete_id)
);

-- インデックス
CREATE INDEX idx_training_scores_event ON training_scores(event_id);
CREATE INDEX idx_training_scores_judge ON training_scores(judge_id);
CREATE INDEX idx_training_scores_athlete ON training_scores(athlete_id);
```

---

## 🎯 機能要件

### 1. セッション作成フロー

#### 既存の大会モードとの統合

`/src/routes/session/create/+page.svelte` を拡張

```svelte
<script lang="ts">
  let mode: 'certification' | 'tournament' | 'training' = 'certification';
  let maxJudges = 100; // 研修モードのデフォルト
</script>

<div class="mode-selector">
  <label>
    <input type="radio" bind:group={mode} value="certification" />
    検定モード
  </label>
  <label>
    <input type="radio" bind:group={mode} value="tournament" />
    大会モード
  </label>
  <label>
    <input type="radio" bind:group={mode} value="training" />
    研修モード（新機能）
  </label>
</div>

{#if mode === 'training'}
  <div class="training-settings">
    <h3>研修モード設定</h3>

    <label>
      最大検定員数（1〜100）
      <input type="number" bind:value={maxJudges} min="1" max="100" />
    </label>

    <p class="info">
      研修モードでは、検定員ごとの採点を個別に表示します。
      3審3採・5審3採のような集計は行いません。
    </p>
  </div>
{/if}
```

### 2. 主任検定員の選択

セッション作成後、参加者一覧から主任検定員を選択

`/src/routes/session/[id]/training-settings/+page.svelte` (新規作成)

```svelte
<script lang="ts">
  import type { PageData } from './$types';

  export let data: PageData;

  let chiefJudgeId: number | null = data.training_session?.chief_judge_id;

  async function updateChiefJudge() {
    const response = await fetch(`/api/training-sessions/${data.session.id}/chief-judge`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chief_judge_id: chiefJudgeId })
    });

    if (response.ok) {
      alert('主任検定員を設定しました');
    }
  }
</script>

<h2>研修モード設定</h2>

<div class="chief-judge-selector">
  <h3>主任検定員の選択</h3>

  <select bind:value={chiefJudgeId}>
    <option value={null}>選択してください</option>
    {#each data.judges as judge}
      <option value={judge.id}>
        {judge.name} {judge.id === chiefJudgeId ? '(現在の主任)' : ''}
      </option>
    {/each}
  </select>

  <button on:click={updateChiefJudge}>設定を保存</button>
</div>
```

### 3. 種目設定（自由入力）

大会モードと同様のUIを流用

`/src/routes/session/[id]/training-events/+page.svelte` (新規作成)

```typescript
// +page.server.ts
export const actions = {
  createEvent: async ({ request, params, locals: { supabase } }) => {
    const formData = await request.formData();
    const name = formData.get('name') as string;

    const { error } = await supabase
      .from('training_events')
      .insert({
        session_id: params.id,
        name,
        order_index: await getNextOrderIndex(params.id)
      });

    if (error) return fail(500, { error: error.message });
    return { success: true };
  }
};
```

### 4. 採点フロー

#### 主任検定員の権限
- 種目の開始・終了
- ゼッケン番号の入力（選手の選択）
- 採点完了の確認

#### 一般検定員の権限
- 採点入力のみ

採点画面は大会モードの `score/+page.svelte` を参考に作成

`/src/routes/session/[id]/training-events/[eventId]/score/+page.svelte`

```svelte
<script lang="ts">
  export let data: PageData;

  let score = '';

  async function submitScore() {
    const response = await fetch(`/api/training-scores`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event_id: data.event.id,
        judge_id: data.currentJudge.id,
        athlete_id: data.currentAthlete.id,
        score: parseFloat(score)
      })
    });

    if (response.ok) {
      score = '';
      // 次の選手へ
    }
  }
</script>

<div class="scoring-panel">
  <h2>{data.event.name}</h2>
  <p>選手: {data.currentAthlete?.name || '待機中...'}</p>

  {#if data.currentAthlete}
    <input
      type="number"
      bind:value={score}
      min={data.event.min_score}
      max={data.event.max_score}
      step={Math.pow(10, -data.event.score_precision)}
      placeholder="点数を入力"
    />

    <button on:click={submitScore} disabled={!score}>
      採点を送信
    </button>
  {:else}
    <p class="waiting">主任検定員が選手を選択するまでお待ちください...</p>
  {/if}
</div>
```

### 5. スコアボード（個別表示）

**マトリックス形式**で検定員ごとの点数を表示

`/src/routes/session/[id]/training-events/[eventId]/scoreboard/+page.svelte`

```svelte
<script lang="ts">
  export let data: PageData;

  // データ構造: scores[athlete_id][judge_id] = score
  let scoreMatrix = buildScoreMatrix(data.scores);
</script>

<div class="scoreboard-matrix">
  <table>
    <thead>
      <tr>
        <th>選手名</th>
        {#each data.judges as judge}
          <th>
            {judge.name}
            {#if judge.id === data.training_session.chief_judge_id}
              <span class="badge">主任</span>
            {/if}
          </th>
        {/each}
        <th>平均点</th>
        <th>標準偏差</th>
      </tr>
    </thead>
    <tbody>
      {#each data.athletes as athlete}
        <tr>
          <td class="athlete-name">{athlete.name}</td>
          {#each data.judges as judge}
            <td class="score">
              {scoreMatrix[athlete.id]?.[judge.id] ?? '-'}
            </td>
          {/each}
          <td class="average">{calculateAverage(scoreMatrix[athlete.id])}</td>
          <td class="stddev">{calculateStdDev(scoreMatrix[athlete.id])}</td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>

<style>
  table {
    width: 100%;
    border-collapse: collapse;
  }

  th, td {
    border: 1px solid #ddd;
    padding: 8px;
    text-align: center;
  }

  .athlete-name {
    font-weight: bold;
    text-align: left;
  }

  .badge {
    background: #ffc107;
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 0.75rem;
  }

  .average {
    background: #e3f2fd;
    font-weight: bold;
  }

  .stddev {
    background: #fff3e0;
  }
</style>
```

---

## 🗺️ 実装ロードマップ

### フェーズ1: データベース基盤（1週間）

#### 1.1 スキーマ拡張

- [ ] `sessions` テーブルに `mode` カラム追加
- [ ] `training_sessions` テーブル作成
- [ ] `training_events` テーブル作成
- [ ] `training_scores` テーブル作成
- [ ] RLSポリシー設定
- [ ] インデックス作成

**実装ファイル:**
- `supabase/migrations/XXX_add_training_mode.sql`

#### 1.2 マイグレーション実行

- [ ] 開発環境でマイグレーションテスト
- [ ] 既存データの互換性確認
- [ ] 本番環境へのマイグレーション

---

### フェーズ2: セッション作成・設定（1週間）

#### 2.1 モード選択UI

- [ ] セッション作成画面に研修モードオプション追加
- [ ] 検定員数の制限設定（最大100名）
- [ ] プラン制限の確認（フリープランは研修モード不可）

**実装ファイル:**
- `src/routes/session/create/+page.svelte` (既存を拡張)
- `src/routes/session/create/+page.server.ts` (既存を拡張)

**参考:**
- `src/routes/session/create/+page.svelte:42-68` (既存の大会モード選択UI)

#### 2.2 主任検定員選択

- [ ] 研修モード設定ページ作成
- [ ] 参加者一覧から主任検定員を選択
- [ ] API エンドポイント作成

**実装ファイル:**
- `src/routes/session/[id]/training-settings/+page.svelte` (新規)
- `src/routes/session/[id]/training-settings/+page.server.ts` (新規)
- `src/routes/api/training-sessions/[id]/chief-judge/+server.ts` (新規)

#### 2.3 権限管理

- [ ] 主任検定員のロール判定ロジック
- [ ] 一般検定員の権限制限
- [ ] セッション作成者権限との統合

**実装ファイル:**
- `src/lib/server/auth/training.ts` (新規)

**参考:**
- `src/routes/session/[id]/tournament-events/[eventId]/score/status/+page.server.ts:14-32` (既存の権限チェック)

---

### フェーズ3: 種目管理（1週間）

#### 3.1 種目作成・編集

- [ ] 種目一覧ページ作成
- [ ] 種目追加フォーム
- [ ] 種目の順序変更機能
- [ ] 種目削除機能

**実装ファイル:**
- `src/routes/session/[id]/training-events/+page.svelte` (新規)
- `src/routes/session/[id]/training-events/+page.server.ts` (新規)

**参考:**
- `src/routes/session/[id]/tournament-events/+page.svelte` (大会モードの種目管理)

#### 3.2 種目詳細設定

- [ ] 採点範囲（最小・最大）設定
- [ ] 小数点精度設定
- [ ] 種目ステータス管理

---

### フェーズ4: 採点機能（2週間）

#### 4.1 主任検定員の操作画面

- [ ] 種目開始ボタン
- [ ] ゼッケン番号入力（選手選択）
- [ ] 採点状況のリアルタイム表示
- [ ] 次の選手へ進むボタン

**実装ファイル:**
- `src/routes/session/[id]/training-events/[eventId]/control/+page.svelte` (新規)
- `src/routes/session/[id]/training-events/[eventId]/control/+page.server.ts` (新規)

**参考:**
- `src/routes/session/[id]/tournament-events/[eventId]/score/status/+page.svelte` (大会モードの主任画面)

#### 4.2 検定員の採点画面

- [ ] 現在の選手情報表示
- [ ] 採点入力フォーム
- [ ] バリデーション（範囲チェック）
- [ ] 送信後の次の選手待機

**実装ファイル:**
- `src/routes/session/[id]/training-events/[eventId]/score/+page.svelte` (新規)
- `src/routes/session/[id]/training-events/[eventId]/score/+page.server.ts` (新規)

**参考:**
- `src/routes/session/[id]/tournament-events/[eventId]/score/+page.svelte` (大会モードの採点画面)

#### 4.3 リアルタイム通知

- [ ] 選手選択時の通知（検定員側）
- [ ] 採点完了状況の通知（主任側）
- [ ] ポーリング機構（3秒間隔）

**実装ファイル:**
- `src/lib/utils/polling.ts` (既存を流用)

**参考:**
- `src/routes/session/[id]/tournament-events/[eventId]/score/+page.svelte:26-42` (既存のポーリング)

#### 4.4 採点データAPI

- [ ] POST `/api/training-scores` (採点送信)
- [ ] GET `/api/training-scores/[eventId]` (種目の全採点取得)
- [ ] GET `/api/training-scores/status/[eventId]` (採点状況確認)

**実装ファイル:**
- `src/routes/api/training-scores/+server.ts` (新規)
- `src/routes/api/training-scores/[eventId]/+server.ts` (新規)
- `src/routes/api/training-scores/status/[eventId]/+server.ts` (新規)

---

### フェーズ5: スコアボード（1週間）

#### 5.1 マトリックス表示

- [ ] 選手×検定員の採点マトリックス
- [ ] 平均点・標準偏差の計算
- [ ] 主任検定員のハイライト表示
- [ ] レスポンシブ対応（横スクロール）

**実装ファイル:**
- `src/routes/session/[id]/training-events/[eventId]/scoreboard/+page.svelte` (新規)
- `src/routes/session/[id]/training-events/[eventId]/scoreboard/+page.server.ts` (新規)
- `src/lib/components/TrainingScoreMatrix.svelte` (新規コンポーネント)

#### 5.2 統計情報

- [ ] 検定員ごとの平均採点
- [ ] 選手ごとの得点分布
- [ ] ヒートマップ表示（オプション）

**実装ファイル:**
- `src/lib/utils/statistics.ts` (新規)

#### 5.3 公開スコアボード

- [ ] 研修モード用の公開URL
- [ ] リアルタイム更新
- [ ] 印刷用レイアウト

**実装ファイル:**
- `src/routes/scoreboard/training/[sessionId]/[eventId]/+page.svelte` (新規)

**参考:**
- `src/routes/scoreboard/[sessionId]/+page.svelte` (既存の公開スコアボード)

---

### フェーズ6: プラン制限・統合（1週間）

#### 6.1 プラン制限の実装

- [ ] フリープラン: 研修モード不可
- [ ] スタンダード: 検定員20名まで
- [ ] プロ: 検定員100名まで

**実装ファイル:**
- `src/lib/server/plans/limits.ts` (既存を拡張)

**参考:**
- Plan.mdの `plan_limits` テーブル定義

#### 6.2 UI統合

- [ ] セッション一覧に研修モードバッジ表示
- [ ] ナビゲーションメニューに研修モード追加
- [ ] ヘルプページ作成

**実装ファイル:**
- `src/routes/sessions/+page.svelte` (既存を拡張)
- `src/lib/components/SessionCard.svelte` (既存を拡張)
- `src/routes/help/training-mode/+page.svelte` (新規)

#### 6.3 データエクスポート

- [ ] CSV エクスポート（検定員×選手マトリックス）
- [ ] 統計レポート生成

**実装ファイル:**
- `src/routes/api/training-sessions/[id]/export/+server.ts` (新規)

---

### フェーズ7: テスト・最適化（1週間）

#### 7.1 機能テスト

- [ ] セッション作成フロー
- [ ] 主任検定員選択
- [ ] 種目作成・編集
- [ ] 採点フロー（主任・検定員）
- [ ] スコアボード表示
- [ ] 権限管理

#### 7.2 パフォーマンステスト

- [ ] 100名の検定員での採点
- [ ] リアルタイム更新の負荷テスト
- [ ] データベースクエリ最適化
- [ ] スコアボードのレンダリング速度

#### 7.3 エッジケーステスト

- [ ] 主任検定員の変更
- [ ] 検定員の途中追加・削除
- [ ] 採点の修正・削除
- [ ] セッションの削除

---

### フェーズ8: ドキュメント・リリース（1週間）

#### 8.1 ドキュメント作成

- [ ] 研修モード使い方ガイド
- [ ] FAQ追加
- [ ] チュートリアル動画（オプション）

#### 8.2 リリース準備

- [ ] 本番環境へのマイグレーション
- [ ] プラン制限の有効化
- [ ] 料金ページの更新

#### 8.3 リリース後

- [ ] ユーザーフィードバック収集
- [ ] バグ修正
- [ ] 機能改善

---

## 📊 データフロー図

### 研修モードの採点フロー

```
[主任検定員]
    ↓ 1. 種目開始
[training_events.status = 'in_progress']
    ↓ 2. ゼッケン番号入力（例: 5番）
[current_athlete_id = 5]
    ↓ 3. リアルタイム通知
[検定員1〜100]
    ↓ 4. 各自が採点入力
[training_scores テーブルに INSERT]
    ↓ 5. 採点状況をポーリング
[主任検定員の画面に「45/100 完了」と表示]
    ↓ 6. 全員完了したら次の選手へ
[current_athlete_id = 6]
    ↓ 繰り返し...
```

### スコアボード生成フロー

```sql
-- 研修モード用のスコアボードクエリ
SELECT
  athletes.name AS athlete_name,
  judges.name AS judge_name,
  training_scores.score,
  training_scores.is_finalized
FROM training_scores
JOIN participants AS athletes ON training_scores.athlete_id = athletes.id
JOIN participants AS judges ON training_scores.judge_id = judges.id
WHERE training_scores.event_id = $1
ORDER BY athletes.name, judges.name;
```

マトリックス形式に変換:

```typescript
interface ScoreMatrix {
	[athleteId: number]: {
		[judgeId: number]: number; // score
	};
}
```

---

## 🔒 セキュリティ・権限管理

### RLSポリシー

#### training_sessions

```sql
-- セッション作成者のみ編集可能
CREATE POLICY "Session creators can manage training sessions"
  ON training_sessions FOR ALL
  USING (
    session_id IN (
      SELECT id FROM sessions WHERE creator_id = auth.uid()
    )
  );

-- 参加者は閲覧可能
CREATE POLICY "Participants can view training sessions"
  ON training_sessions FOR SELECT
  USING (
    session_id IN (
      SELECT session_id FROM participants WHERE user_id = auth.uid()
    )
  );
```

#### training_scores

```sql
-- 自分の採点のみ編集可能
CREATE POLICY "Judges can manage own scores"
  ON training_scores FOR ALL
  USING (
    judge_id IN (
      SELECT id FROM participants WHERE user_id = auth.uid()
    )
  );

-- 主任検定員は全ての採点を閲覧可能
CREATE POLICY "Chief judges can view all scores"
  ON training_scores FOR SELECT
  USING (
    event_id IN (
      SELECT te.id FROM training_events te
      JOIN training_sessions ts ON te.session_id = ts.session_id
      JOIN participants p ON ts.chief_judge_id = p.id
      WHERE p.user_id = auth.uid()
    )
  );
```

---

## 💡 将来の拡張機能（オプション）

### フェーズ9以降の検討項目

#### 1. 分析機能

- [ ] 検定員の採点傾向分析
- [ ] 基準点との差分表示
- [ ] グラフ可視化（Chart.js / D3.js）

#### 2. フィードバック機能

- [ ] 主任検定員からのコメント機能
- [ ] 採点理由のメモ機能
- [ ] 評価基準の共有

#### 3. 比較機能

- [ ] 過去の研修結果との比較
- [ ] 検定員ごとの成長記録
- [ ] ベンチマーク表示

#### 4. エクスポート拡張

- [ ] PDF レポート生成
- [ ] Excel形式でのエクスポート
- [ ] 統計グラフの画像出力

---

## 🎯 成功指標（KPI）

### 機能的指標

- [ ] 研修モードで100名の検定員が同時採点可能
- [ ] 採点送信から表示まで3秒以内
- [ ] スコアボードの読み込み5秒以内

### ビジネス指標

- [ ] 研修モード利用率: スタンダード以上のプラン加入者の30%以上
- [ ] 大規模研修（50名以上）の実施: 月5件以上
- [ ] ユーザー満足度: 4.5/5以上

---

## 📝 実装時の注意事項

### 1. 大会モードとの違いを明確に

| 項目 | 大会モード | 研修モード |
|------|-----------|-----------|
| 採点集計 | ✓ (3審3採/5審3採) | ✗ (個別表示のみ) |
| 順位計算 | ✓ | ✗ (オプション) |
| 検定員数 | 固定 (3 or 5) | 可変 (1〜100) |
| 用途 | 公式大会 | 研修・トレーニング |

### 2. パフォーマンス最適化

- **100名の検定員**: データベースクエリの最適化が必須
- **インデックス**: `training_scores(event_id, judge_id, athlete_id)`
- **ページネーション**: スコアボードで100列表示する場合、横スクロール対応

### 3. UI/UX

- **モバイル対応**: スコアボードの横スクロールを直感的に
- **リアルタイム更新**: ポーリング間隔を3秒に設定（既存と同じ）
- **権限表示**: 主任検定員にバッジを表示して区別

### 4. テストデータ

```sql
-- テスト用の研修セッション作成
INSERT INTO sessions (name, mode, creator_id) VALUES ('テスト研修', 'training', 'xxx');
INSERT INTO training_sessions (session_id, max_judges) VALUES (1, 100);

-- 100名の検定員を追加
INSERT INTO participants (session_id, name, role)
SELECT 1, 'Judge ' || n, 'judge'
FROM generate_series(1, 100) AS n;
```

---

## 🚀 リリース計画

### マイルストーン

- **Week 1-2**: フェーズ1-2（データベース・セッション作成）
- **Week 3-4**: フェーズ3-4（種目管理・採点機能）
- **Week 5-6**: フェーズ5-6（スコアボード・統合）
- **Week 7-8**: フェーズ7-8（テスト・リリース）

### ベータテスト

- **対象**: スタンダードプラン加入者10名
- **期間**: 2週間
- **フィードバック収集**: Google Forms / アプリ内フィードバック

### 正式リリース

- **リリース日**: ベータテスト完了後1週間以内
- **告知**: メール・アプリ内通知・SNS
- **ドキュメント**: 使い方ガイド・FAQ

---

## 📞 開発サポート

### 参考実装ファイル

研修モードは大会モードの構造を参考に実装します。以下のファイルが参考になります:

| 大会モード（参考） | 研修モード（新規） |
|-------------------|-------------------|
| `tournament_events` テーブル | `training_events` テーブル |
| `/session/[id]/tournament-events/+page.svelte` | `/session/[id]/training-events/+page.svelte` |
| `/score/status/+page.svelte` | `/control/+page.svelte` |
| `/score/+page.svelte` | `/score/+page.svelte` |
| `/scoreboard/[sessionId]/+page.svelte` | `/scoreboard/training/[sessionId]/+page.svelte` |

### 重要な既存ロジック

- **採点集計**: `src/routes/session/[id]/tournament-events/[eventId]/score/status/+page.server.ts:52-147`
- **ポーリング**: `src/routes/session/[id]/tournament-events/[eventId]/score/+page.svelte:26-42`
- **権限チェック**: `src/routes/session/[id]/tournament-events/[eventId]/score/status/+page.server.ts:14-32`

---

## ✅ 完了チェックリスト

### 開発前準備

- [ ] Plan.mdに研修モード実装計画を追加 ✅
- [ ] データベーススキーマ設計の確認
- [ ] 大会モードの既存コードレビュー
- [ ] プロトタイプのワイヤーフレーム作成

### 開発中

- [ ] 各フェーズのタスク完了チェック
- [ ] コードレビュー（各フェーズごと）
- [ ] ユニットテスト作成
- [ ] 統合テスト実施

### リリース前

- [ ] ベータテスト完了
- [ ] ドキュメント完成
- [ ] パフォーマンステストクリア
- [ ] セキュリティ監査

### リリース後

- [ ] ユーザーフィードバック収集
- [ ] バグ修正
- [ ] 機能改善ロードマップ更新
