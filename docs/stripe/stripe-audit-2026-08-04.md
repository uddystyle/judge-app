# Stripe 実装監査（2026-08-04）

> 対象: `src/lib/server/stripe.ts` / `src/lib/server/stripeWebhook/**` / `src/routes/api/stripe/**` / `src/routes/organization/[id]/change-plan/+page.server.ts` / 本番・開発 Supabase のスキーマ。
> 検証方法: コード読解に加え、**Stripe SDK v19 の型定義・Stripe 公式 changelog・実 DB への直接照会・clover 形状ペイロードでの再現テスト**で裏取りした（推測のみの指摘は含めない）。
> 状態: **全項目（P0-1 / P0-2 / H-1〜H-4 / M-1〜M-6）修正済み（2026-08-04、DB は prod/dev とも適用済み）**。
> うち M-2 と、追加で見つかった H-4 は**コードレビュー指摘を受けて設計をやり直した**（下記「レビュー対応」）。修正タスクは [`../../tasks/todo.md`](../../tasks/todo.md) を参照。

## サマリ

| # | 重大度 | 症状 | 影響範囲 |
|---|---|---|---|
| [P0-1](#p0-1-api-バージョン変更で期間フィールド書き込みが全滅) | 🔴 P0 ✅修正済 | API バージョン bump で `current_period_*` が全て `undefined` → `RangeError` → 500 | **決済成立後に組織・サブスクが一切保存されない** |
| [P0-2](#p0-2-dbの-check-制約が-stripe-のステータスを受け付けない) | 🔴 P0 ✅修正済 | `subscriptions.status` の CHECK が Stripe の実ステータスを網羅していない | 本番で `incomplete` / `trialing` が保存不能 |
| [H-1](#h-1-single-が多行で恒久エラーになる) | 🟠 High ✅修正済 | `stripe_customer_id` に `.single()`（複数行が正常な設計） | 2件目以降で恒久 500 ループ |
| [H-2](#h-2-決済確定前にプラン権限を付与している) | 🟠 High ✅修正済 | `subscription.status` を見ずに `organizations.plan_type` を付与 | 未決済で上位プランが有効化 |
| [H-3](#h-3-年額月額のプラン変更は必ず-500-で失敗する実測) | 🟠 High ✅修正済 | `billing_cycle_anchor: 'unchanged'` は interval 変更時に使えず Stripe が 400 | **年額→月額のプラン変更が常に失敗**（UIから到達可能） |
| [M-1](#m-1-400-では-stripe-の再送は止まらない) | 🟡 Med ✅修正済 | `NonRetryableError → 400` は再送を止めない | リトライ嵐・エンドポイント自動無効化 |
| [M-2](#m-2-event-id-による冪等化がない) | 🟡 Med ✅修正済 | 処理済みイベント表なし・順序保証なし | 二重処理の余地 |
| [M-3](#m-3-stripe-customer-の重複生成) | 🟡 Med ✅修正済 | checkout 完了前に毎回 Customer を作成 | 孤児 Customer・UNIQUE 衝突 |
| [M-4](#m-4-プロモコード列挙オラクルレート制限なし) | 🟡 Med ✅修正済 | `?coupon=` ごとに Stripe API・レート制限なし | プロモコード列挙 |
| [M-5](#m-5-max_members-の二重ソース) | 🟡 Med ✅修正済 | metadata と `plan_limits` の二重ソース | 値の乖離 |
| [M-6](#m-6-livemode-判定が-sk_live_-前置詞に依存) | 🟡 Med ✅修正済 | `sk_live_` 前置詞で livemode 判定 | 制限付きキー移行で本番 webhook 全滅 |

**根本原因は 1 点に集中している**: コミット `e96be7d`（2026-08-02）で Stripe API バージョンを bump した際、依存コードの追随監査が行われなかった。P0-1 はその直接の帰結であり、後述の「flexible billing mode」も同じ bump の未検討の副作用。

---

## P0-1: API バージョン変更で、期間フィールド書き込みが全滅

### 事実

`src/lib/server/stripe.ts:9` の pin が変更されている。

```
commit e96be7d (2026-08-02)
-	apiVersion: '2024-12-18.acacia'
+	apiVersion: '2025-10-29.clover'
```

`current_period_start` / `current_period_end` は **`2025-03-31.basil` で Subscription のトップレベルから削除**され、`items.data[].current_period_*` へ移動した。Stripe 公式 changelog の記述:

> Removed the `current_period_start` and `current_period_end` properties on Subscription. Use the one(s) in items for each SubscriptionItem instead.

SDK v19.2.0 の型定義でも裏が取れる。`node_modules/stripe/types/Subscriptions.d.ts` には該当プロパティが**存在せず**、`SubscriptionItems.d.ts:53,58` にのみ存在する。

### 壊れている箇所

`subscriptions.retrieve()` / `subscriptions.update()` の戻り値からトップレベルの期間フィールドを読んでいる箇所（すべて `undefined` になる）:

| ファイル | 行 | 文脈 |
|---|---|---|
| `src/lib/server/stripeWebhook/checkout.ts` | 90-91 | 個人サブスクの upsert |
| `src/lib/server/stripeWebhook/checkout.ts` | 232-233 | 組織アップグレードの upsert |
| `src/lib/server/stripeWebhook/checkout.ts` | 359-360 | 組織新規作成の upsert |
| `src/lib/server/stripeWebhook/invoice.ts` | 44, 75 | `invoice.payment_succeeded` |
| `src/lib/server/stripeWebhook/invoice.ts` | 130 | `invoice.payment_failed` |
| `src/routes/organization/[id]/change-plan/+page.server.ts` | 406-409 | プラン変更後の DB 反映 |
| `src/routes/organization/[id]/delete/+page.server.ts` | 62, 82 | 組織削除画面の解約期限表示（**初回監査で見落とし**） |

> ⚠️ `delete/+page.server.ts` は初回の監査で拾えていなかった。grep 対象を webhook 配下に絞ったことと、当該箇所が `try/catch` でログのみ出して例外を握り潰すため**全件テストが緑のまま壊れていた**ことが原因。修正時に `withSubscriptionPeriods` の import エラーで発覚した。教訓は [`../../tasks/lessons.md`](../../tasks/lessons.md) に記録。

`new Date(undefined * 1000).toISOString()` は `new Date(NaN).toISOString()` となり **`RangeError: Invalid time value`** を送出する。

### 再現結果

clover 形状（期間フィールドが `items.data[]` にのみ存在）のペイロードで webhook ハンドラを実行した結果:

```
>> personal checkout status: 500
>> message: イベント処理エラー: Invalid time value
>> DB upsert called: 0 time(s)          ← サブスクリプションが一切保存されない

>> invoice.payment_succeeded status: 500
>> message: リトライ可能なエラー: handlePaymentSucceeded エラー: Invalid time value
```

**顧客の決済は成立するが、組織もサブスクリプションも作成されない。** Stripe は 3 日間再送を続け、すべて失敗する。

### なぜテストで検出できないか

既存の 75 テストは全て通る。`src/lib/server/__tests__/stripe.webhook.test.ts:550-569` をはじめとする `stripe.subscriptions.retrieve` のモックが、**旧 acacia 形状（トップレベルに期間フィールド）のまま**だから。

```ts
vi.mocked(stripe.subscriptions.retrieve).mockResolvedValue({
	id: 'sub_test_123',
	current_period_start: 1640995200,   // ← clover では返ってこない
	current_period_end: 1643673600,
	items: { data: [{ price: { ... } }] }  // ← 本来はここに期間がある
} as any);
```

モックが実 API の契約から乖離しており、回帰テストとして機能していない。

### 型チェックをすり抜けた理由

`src/lib/server/stripeTypes.ts:13-17` の `withSubscriptionPeriods()` は実体が `as` キャストのみで、**実行時には何も補わない**。

```ts
export function withSubscriptionPeriods(
	subscription: Stripe.Response<Stripe.Subscription> | Stripe.Subscription
): SubscriptionWithPeriods {
	return subscription as SubscriptionWithPeriods;   // 実行時は素通し
}
```

「SDK の型からフィールドが消えた」という**破壊の予兆そのもの**を握り潰す役割を果たしていた。型エラーが出ていれば bump 時に気づけたはずの箇所である。

### 修正内容（2026-08-04 実施・✅ 完了）

TDD で対応。clover 形状の失敗テストを先に書いて 6 件の RED（全て `RangeError: Invalid time value`）を確認してから実装した。

- 期間読み取りを `src/lib/server/stripeTypes.ts` の `getSubscriptionPeriod()` に一元化（両形状を**実行時に**読む）。webhook 用に `requireSubscriptionPeriod()`（取得不可なら `RetryableError`）を `stripeWebhook/shared.ts` に追加
- `withSubscriptionPeriods` / `SubscriptionWithPeriods` を**削除**。型の穴を塞いだ
- `change-plan` は Stripe 側が既に変更済みのため、期間が読めない場合は握り潰さず `fail(500)` で明示的に失敗させる
- テストモック 12 箇所を clover 形状へ更新。ただし **SDK 呼び出しの戻り値のみ**で、webhook のイベント payload は旧形状を残した（エンドポイントの API バージョン設定や再送された過去イベントでは旧形状が届き得るため、後方互換の担保として機能する）
- 回帰テストを追加: `stripe.webhook.api-version.test.ts`（6件）/ `change-plan.action.test.ts`（1件）/ `organization/[id]/delete/page.server.test.ts`（2件・新規）

検証: **984 tests passed**、`svelte-check` 0 errors、変更ファイルは prettier・eslint クリーン。

### 併せて確認した副作用: billing mode（✅ 検証済み・回帰なし）

`2025-09-30.clover` 以降、新規サブスクリプションの `billing_mode` 既定が **`classic` → `flexible`** に変わる。pin した `2025-10-29.clover` はこれに該当する。アプリは `billing_mode` を明示していないため（`grep -rn "billing_mode" src/` は 0 件）、API バージョンの既定に従う。

**テストモードで実測**（両バージョンでサブスクリプションを作成し比較。作成物は片付け済み）:

| apiVersion | 実際の `billing_mode` |
|---|---|
| `2025-10-29.clover`（現在） | `flexible` |
| `2024-12-18.acacia`（bump前） | `classic` |

既定が変わること自体は事実だったが、**`change-plan` のプロレーション制御に回帰は無かった**。同じパラメータで両バージョンを叩いた結果が一致する:

| 経路 | パラメータ | clover(flexible) | acacia(classic) |
|---|---|---|---|
| アップグレード同間隔 | `always_invoice` + `anchor=now` | ✅ | ✅ |
| ダウングレード同間隔 | `none` + `anchor=unchanged` | ✅ | ✅ |
| 月額→年額 | `always_invoice` + `anchor=now` | ✅ | ✅ |
| **年額→月額** | `none` + `anchor=unchanged` | ❌ 400 | ❌ 400 |

年額→月額だけが失敗するが、**これは bump とは無関係の既存バグ**（acacia でも同じく失敗する）。H-3 として別項目に切り出した。

なお `billing_mode` はサブスクリプション**作成時**に決まるため、2026-08-02 の bump 以降に作られた契約は `flexible`、それ以前は `classic` という**混在**になる。現時点でプロレーション挙動に差は出ていないが、将来 `billing_cycle_anchor` を省略する実装に変えると差が出る（flexible はアンカーを自動リセットしない）ことは覚えておくこと。

### 誤ったコメント（✅ 是正済み）

bump 時に追随監査が行われなかった証跡として、以下のコメントが「acacia を pin 中」と記述していた。いずれも是正済み。

- `src/lib/server/stripeWebhook/shared.ts` — 「pin された SDK 経由の `subscriptions.retrieve()` は acacia 形状=トップレベルを返す」
- `src/routes/organization/create/+page.server.ts` — 「pin中のAPIバージョン（acacia）はトップレベル coupon」。**説明が逆**だった: SDK v19 の `PromotionCode` 型にトップレベル `coupon` は無く、clover では `promotion.coupon` が正。コードは両形状を読んでいたため動作は正しく、コメントだけが誤っていた

---

## P0-2: DBの CHECK 制約が Stripe のステータスを受け付けない

### 事実（実 DB を直接照会）

| 環境 | `subscriptions.status` で許可される値 |
|---|---|
| **本番** (`scoring-system` / kbxlukbvhlxponcentyp) | `active, canceled, past_due, unpaid` |
| **開発** (`tento-development` / qyxjoybicsmiysqrevhk) | `active, past_due, canceled, incomplete, trialing` |

Stripe の Subscription ステータスは `incomplete, incomplete_expired, trialing, active, past_due, canceled, unpaid, paused`。コードは `status: subscription.status` を**変換せずそのまま**書き込む（`checkout.ts:87`, `subscription.ts:68`, ほか）。

### 影響

- **本番**: `incomplete` / `trialing` が CHECK 違反 → `RetryableError` → 500 → 再送ループ。
  とりわけ `checkout.ts:257` の SEC-1b は **`incomplete` が来ることを前提に設計されている**のに、その値を保存できない。
- **開発**: `unpaid` が保存できない。`subscription.ts:235-239` のコメントは「unpaid / canceled 等の非課金ステータス」を扱う前提で書かれているが、DB が受け付けない。
- **両環境**: `incomplete_expired` / `paused` が未対応。

### 制約どうしの矛盾

本番の部分一意インデックス `subscriptions_organization_active_unique` は

```sql
WHERE (status = ANY (ARRAY['active'::text, 'trialing'::text]))
```

と `trialing` を参照しているが、同じテーブルの CHECK 制約は `trialing` を**禁止**している。インデックスの条件が原理的に成立しない状態。

### plan_type 側にも同種の穴

本番・開発とも `subscriptions_plan_type_check` / `organizations_plan_type_check` は `free, basic, standard, premium` のみを許可する。一方 `src/lib/server/plans.ts:39-42,66` は旧個人プランの price ID に対して **`'pro'` を返す**。レガシー契約のイベントが届くと CHECK 違反になる。

### 修正内容（2026-08-04・✅ 完了）

マイグレーション `1029_subscription_status_check_stripe_alignment.sql`（+ `rollbacks/1029_rollback.sql` + `verify/1029_verify_status_check.sql`）。

- **CHECK を Stripe の全8ステータスへ拡張**した（アプリ側で正規化する案は採らなかった。webhook が Stripe の値をそのまま保存する現設計を維持でき、実ステータスの情報を失わないため）
- `trialing` が CHECK に入ったことで、prod の部分一意インデックスとの矛盾も解消
- **`pro` は CHECK に足さず、アプリ側から廃止**した（旧個人プランの契約が存在しないことをユーザーに確認）。`findPlanTypeByPriceId` の戻り値型からも除去し、旧個人pro の price ID は意図的に未マッピングのまま残して「未知のprice ID」として明示的に失敗させる。`PERSONAL_STANDARD_PRICES` は `standard` が DB 的に正当な値でバグではないため残した（最小影響）
- dev にだけ欠けていた `plan_type` / `billing_interval` の CHECK も prod 定義で追加（ドリフト解消）
- 回帰テスト `plans.priceMapping.test.ts`（新規4件）が「`findPlanTypeByPriceId` は DB の CHECK が許可しない値を返さない」を不変条件として固定する

**prod・dev とも適用・検証済み**（2026-08-04）: 一時テーブルに8ステータス全件が投入できることを確認、既存データの不適合 0 件、prod の部分一意インデックスとの矛盾も解消。`APPLIED.md` 更新済み。

---

## H-1: `.single()` が多行で恒久エラーになる

`src/lib/server/stripeWebhook/subscription.ts:20-24`

```ts
const { data: subData, error: fetchError } = await supabaseAdmin
	.from('subscriptions')
	.select('user_id, organization_id')
	.eq('stripe_customer_id', customerId)
	.single();
```

`database/migrations/053_fix_subscriptions_unique_constraint.sql` は **「1人のユーザー（1つの Stripe Customer）が複数の組織でサブスクリプションを持てる」ようにするため意図的に `stripe_customer_id` の UNIQUE を削除**している（実 DB でも UNIQUE なし・通常インデックスのみを確認）。

つまり同一 Customer に複数行が存在するのは**設計上の正常系**だが、`.single()` は 0 行でも複数行でもエラーを返す。2 件目ができた時点で `customer.subscription.created` が恒久的に 500 を返し続ける。

修正方針: `.order(...).limit(1).maybeSingle()` にするか、`stripe_subscription_id` で引く。どの行を選ぶべきかの意図（最新か、当該サブスクか）を明示すること。

---

## H-2: 決済確定前にプラン権限を付与している

`src/lib/server/stripeWebhook/checkout.ts:205-213`（アップグレード）と `300-316`（新規作成）は、`subscription.status` を確認せずに `organizations.plan_type` / `max_members` を設定する。

同じ関数の `checkout.ts:257`（SEC-1b）は

```ts
if (!['active', 'trialing'].includes(subscription.status)) {
```

と決済未確定を判定しているが、これが守っているのは**「旧サブスクリプションの解約」だけ**で、**「新プランの付与」は守っていない**。結果、`incomplete`（決済未確定）のサブスクリプションでも上位プランが即座に有効になる。

`handleSubscriptionUpdated` の `ENTITLED_STATUSES`（`subscription.ts:238`）が後続イベントで free へ降格させるため自動修復はされるが、そのイベントが届くまでの間は未決済で有料機能が使える。

修正方針: 付与側にも同じステータス判定を適用する（SEC-1b の判定を関数先頭へ引き上げ、付与・解約の両方で共有する）。

---

## H-3: 年額→月額のプラン変更は必ず 500 で失敗する（実測）

### 事実

`change-plan/+page.server.ts` のプロレーション決定は次の2分岐しかない。

```ts
if (isUpgrade || isMonthToYear) {
	prorationBehavior = 'always_invoice';
	billingCycleAnchor = 'now';
} else {
	prorationBehavior = 'none';
	billingCycleAnchor = 'unchanged';   // ← 年額→月額もここに落ちる
}
```

`isYearToMonth` は算出されログにも出るが、**分岐に使われていない**。結果、年額→月額は
`proration_behavior: 'none'` + `billing_cycle_anchor: 'unchanged'` で Stripe を呼び、
Stripe は interval 変更時にこの組み合わせを拒否する:

```
400 Changing plan intervals. There's no way to leave billing cycle unchanged.
param: billing_cycle_anchor
```

テストモードで実測し、**clover / acacia の両方**で再現した（＝API バージョン bump とは無関係の既存バグ）。
アクションの catch がこれを拾い、`fail(500, 'プラン変更に失敗しました。Changing plan intervals...')` を返す。

### 到達経路

`change-plan/+page.svelte` は月額／年額のトグルを持ち、年額契約中に「月額」を選べる。
さらに UI は**具体的な挙動を約束している**:

> 年額から月額への変更です。変更は即座に適用されます。次回の請求日まで追加の請求は発生しません。

実際にはエラーになるため、この説明は果たされていない。

### 修正候補（テストモードで実測。basic年額 ¥88,000 契約直後 → basic月額 ¥8,800）

| 候補 | パラメータ | clover の結果 | 顧客への影響 |
|---|---|---|---|
| A | `none` + `anchor=now` | 即時 ¥8,800 請求 / 調整なし | **前払いした年額分が失われる** |
| B | `create_prorations` + `anchor=now` | ¥-79,200 のクレジット | 未使用分が返る |
| C | `none` + anchor 省略 | 追加請求なし | **前払い分が失われる**（さらに acacia とは挙動が違う） |
| D | `create_prorations` + anchor 省略 | ¥-79,200 を次回請求へ繰越 | 未使用分が返る |
| E | `always_invoice` + `anchor=now` | ¥-79,200 を即時確定 | 未使用分が返る |

**注意**: UI の文言（「追加の請求は発生しません」）に最も近いのは A / C だが、どちらも
**顧客が前払いした年額の未使用分を失う**。単に 500 を消すだけの修正を選ぶと、
エラーが「静かな不利益」に置き換わるだけになる。

### 採用した修正（✅ 完了・2026-08-04）

**候補 E（即時変更＋未使用分をクレジット）** を採用（ユーザー判断）。分岐条件を
`isUpgrade || isMonthToYear` から **`isUpgrade || isBillingIntervalChange`** に変え、
間隔変更は月↔年のどちらの向きでも `always_invoice` + `anchor=now` を使う。
同一間隔のダウングレードは従来どおり `none` + `unchanged`（回帰テストで固定）。

UI 文言も実挙動に合わせて修正した（「次回の請求日まで追加の請求は発生しません」→
「お支払い済みの年額のうち未使用分は日割りでクレジットされ、以後の月額のお支払いに充当されます」）。
同一間隔ダウングレードの説明文は実挙動と一致するため据え置き。

**修正後に実 API（テストモード）で全経路を再確認**（作成物は片付け済み）:

| 経路 | パラメータ | 直近の請求書 |
|---|---|---|
| アップグレード同間隔 | `always_invoice` + `now` | ¥41,000 |
| ダウングレード同間隔 | `none` + `unchanged` | （変更なし） |
| 月額→年額 | `always_invoice` + `now` | ¥79,200 |
| **年額→月額** | `always_invoice` + `now` | **¥-79,200（クレジット）** |
| **年額→月額かつダウングレード** | `always_invoice` + `now` | **¥-489,200（クレジット）** |

全経路が成功し、年額→月額では未使用分が顧客のクレジットとして返る。

---

## M-1: 400 では Stripe の再送は止まらない

`src/routes/api/stripe/webhook/+server.ts:126-138` は `NonRetryableError` を 400、`RetryableError` を 500 にマップし、400 を「リトライ不要」と表現している。

しかし **Stripe は 2xx 以外を一律で最大 3 日間・指数バックオフで再送する**（公式ドキュメントは 4xx と 5xx をどちらも `ERR`＝配信失敗として同列に扱い、リトライ挙動を区別していない）。4xx を返しても再送は止まらない。

実際の影響は「リトライ嵐 + ダッシュボードのエラー蓄積 + エンドポイント自動無効化のリスク」。

修正方針: 本当に処理不能なイベント（データ不正など、再送しても永久に成功しない種類）は **200 を返しつつログ／アラートに落とす**。500 は「後で成功しうる」場合に限定する。

---

## M-2: event.id による冪等化がない

処理済みイベントを記録するテーブルが存在しない（`stripe_events` 等を全 grep したが不在）。現状は upsert の冪等性に依存している。

- 多くの経路は `onConflict` 指定の upsert で冪等
- ただし `handleOrganizationCheckout` のアップグレード経路は Stripe 側の `subscriptions.list()` → `cancel()` を伴い、純粋な冪等ではない
- Stripe は**イベント順序を保証しない**と明言している（`customer.subscription.created` が `checkout.session.completed` より先に届く前提のコメントが `subscription.ts:27-29` にあり、認識自体はある）

修正方針: `stripe_events(event_id primary key, processed_at)` を追加し、ハンドラ入口で挿入を試みて衝突したらスキップする。

---

## M-3: Stripe Customer の重複生成

`src/routes/api/stripe/create-organization-checkout/+server.ts:113-121` は、**checkout 完了前に毎回新しい Customer を作成**する。

- ユーザーが checkout を放棄すると孤児 Customer が残る（レート制限は 10 回/時なので上限はある）
- `organizations.stripe_customer_id` は prod/dev とも **UNIQUE**（実 DB で確認）。部分的失敗後の再試行で衝突する余地がある

対して `upgrade-organization/+server.ts:119-141` は既存 `stripe_customer_id` を再利用しており、こちらは適切。

修正方針: 既存 Customer の検索・再利用、または Checkout Session の `customer_creation` に委ねる。

---

## M-4: プロモコード列挙オラクル（レート制限なし）

`src/routes/organization/create/+page.server.ts:53-79` は、ユーザー制御の `?coupon=` パラメータごとに `stripe.promotionCodes.list()` を呼び、有効なら割引内容を返す。**この load にはレート制限がない**。

コメントは「coupon ID の直接参照を避けることで内部用クーポンの列挙を防ぐ」と述べているが、promotion code 自体はここで総当たり判定できる（有効/無効 + 割引率が返る）。

checkout 系エンドポイント（`create-organization-checkout` / `upgrade-organization`）は `rateLimiters.expensive`（10 回/時）で保護されており、**この load だけが非対称に無防備**。

修正方針: この load にもレート制限を適用する。副次的に Stripe API の呼び出し量も抑えられる。

---

## M-5: `max_members` の二重ソース

| 経路 | 出所 |
|---|---|
| `checkout.ts:113,126` | Checkout の `session.metadata.max_members` |
| `subscription.ts:86-99` | `plan_limits` テーブル |

同じ値が別ソースから設定される。metadata は checkout 作成時点でスナップショットされるため、`plan_limits` を変更しても既存の metadata は古いままで、イベント種別によって結果が変わる。

修正方針: `plan_limits` を単一の正とし、metadata の `max_members` は使わない（記録目的で残すなら参照しないことを明記する）。

---

## M-6: livemode 判定が `sk_live_` 前置詞に依存

`src/routes/api/stripe/webhook/+server.ts:47`

```ts
const expectedLivemode = STRIPE_SECRET_KEY.startsWith('sk_live_');
```

Stripe の推奨は**制限付き API キー（`rk_` 前置詞）**の利用。`rk_live_` へ移行した瞬間 `expectedLivemode` が `false` になり、本番イベント（`livemode: true`）が全て「テスト鍵の環境に本番イベント」と判定されて **503 を返し続ける**（同ファイル 62-67 行）。

修正方針: `/^(sk|rk)_live_/` で判定する。あわせて制限付きキーへの移行自体も検討対象。

---

## 妥当に実装されている点（再検証で確認済み・デグレ防止のため記録）

- **署名検証**: `constructEventAsync` + `request.text()` の生ボディ。edge ランタイム互換の理由も明記されている（`webhook/+server.ts:33-36`）
- **プラン判定を Stripe の price ID から導出**: クライアント由来の metadata を信用していない（`shared.ts:66` → `plans.ts:51`）。未知の price ID は明示エラー化
- **オープンリダイレクト対策**: 同一オリジン + パス許可リスト（`validation.ts:294-303,313-`）
- **クーポン**: coupon ID の直接適用を拒否し promotion code のみ受理（列挙対策は M-4 を参照）
- **認可**: Stripe 呼び出しより前に `isOrgAdmin` を実行。退会済みメンバーを `removed_at` で除外
- **CSP**: `js.stripe.com` / `api.stripe.com` を script-src / connect-src / frame-src に登録済み（`svelte.config.js:31-41`）
- **`payment_method_types` を指定していない**: 動的支払い方法が有効（Stripe 推奨）
- **シークレット管理**: ソースへのキー混入なし。環境変数経由
- **Service Role の使用範囲**: webhook と SEC-3 の書き込みに限定され、理由がコメントされている

## 追加の推奨（今回の不具合とは独立）

- `sk_` → **制限付き API キー（`rk_`）**への移行（最小権限）。M-6 の修正が前提
- webhook エンドポイントへの **Stripe IP 許可リスト**適用（多層防御）
- P0 解消後に、最新 API バージョンへの計画的な追随（今回と同じく**依存コード監査をセットで**行うこと）

---

## 追加の観測: 本番の課金データが 2026-04 以降更新されていない（要調査）

P0-2 の作業中に気づいた点で、**監査項目としては未検証**。断定はできないが調べる価値がある。

本番 `subscriptions` の唯一の有料契約:

| 項目 | 値 |
|---|---|
| `stripe_subscription_id` | `sub_1T6UbI...`（**live mode のオブジェクト**であることを確認） |
| `status` | `active` |
| `created_at` | 2026-03-02 |
| `current_period_end` | **2026-04-02** |

月額契約なので `invoice.payment_succeeded` が毎月 `current_period_end` を進めるはずだが、
**2026-04-02 から 4 ヶ月分進んでいない**。P0-1（clover bump）は 2026-08-02 なので**時期が合わない**。
より古い原因（live の webhook エンドポイント未設定・署名シークレット不一致・契約自体の終了など）が
別にある可能性がある。

確認には live キーまたは Stripe ダッシュボードが必要（MCP は test キーのため live オブジェクトを読めない）。
**確認すべきこと**: ダッシュボードの Webhooks → live エンドポイントの有無と直近の配信結果、
および当該サブスクリプションが実際に更新され続けているか。

---

## H-1〜M-6 の修正内容（2026-08-04・✅ 完了）

すべて TDD（失敗テスト → 実装 → 検証）で対応した。最終検証は **1001 tests passed / svelte-check 0 errors**。

| # | 修正 | 対応方針の要点 |
|---|---|---|
| H-1 | `handleSubscriptionCreated` の行特定を `stripe_customer_id` + `.single()` から **`stripe_subscription_id` + `.maybeSingle()`** へ | migration 053 が customer の UNIQUE を意図的に外している以上、customer で引くと複数行が正常系。部分一意索引のある subscription_id なら高々1行 |
| H-2 | 権限付与を `isEntitledStatus()` で門番 | アップグレードは未確定なら**旧サブスクの切り離しも昇格も行わない**（組織は課金中の旧プランのまま据え置き）。新規は **free で作成**し、後続の `customer.subscription.updated` が昇格させる |
| M-1 | `NonRetryableError` を 400 → **200 + `dropped: true`** | Stripe は 2xx 以外を 4xx/5xx の区別なく最大3日再送する。非2xx はリトライ嵐とエンドポイント自動無効化を招く。可視化は error ログが担う |
| M-2 | `stripe_events`（migration 1030）による冪等化 | **INSERT の一意制約違反＝処理済み**と判定。チェックしてから書く方式と違い同時配信でも競合しない。再送で処理し直す必要がある失敗（Retryable）では記録を取り消す |
| M-3 | Checkout の **Customer 事前作成を廃止**し `customer_email` に変更 | subscription モードでは Stripe が**セッション完了時にのみ** Customer を作る（テストモードで実測: 放棄しても Customer 件数が増えない）。孤児と UNIQUE 衝突の要因を根絶 |
| M-4 | `organization/create` の load にレート制限 | `?coupon=` ごとに Stripe を叩ける無防備な列挙オラクルだった。制限時はページは表示しクーポンだけ未適用にする（通常利用を壊さない） |
| M-5 | `max_members` を **`plan_limits` 単一ソース**へ | metadata は checkout 作成時点のスナップショットで、`plan_limits` 変更後も古いまま残る。必要な分岐でのみ引く（未確定パスに不要な失敗点を作らない） |
| M-6 | livemode 判定を `/^(sk\|rk)_live_/` へ | Stripe 推奨の制限付きキー（`rk_live_`）へ移行した瞬間、**本番 webhook が全て 503** になる状態だった |

### テスト側で併せて直した設計上の問題

`stripe.webhook.test.ts` の `beforeEach` は `vi.clearAllMocks()` のみで、**`mockReturnValueOnce` のキューが消えていなかった**。
あるテストが消費しなかった分が後続テストへ漏れ、無関係なテストが連鎖的に落ちる（今回、実際の失敗14件に対し40件が落ちた）。
`mockSupabaseClient.from.mockReset()` を追加して解消した。

また、ディスパッチャのテストは冪等化層（DB アクセス）を `vi.mock` で差し替えた。
M-2 の実挙動は専用ファイル `stripe.webhook.hardening.test.ts` が検証する。

---

## レビュー対応（2026-08-04・第2ラウンド）

初回修正に対するコードレビューで **5件**の指摘を受け、すべて対応した。うち2件は
**私の初回修正そのものが作り込んだ欠陥**である。最終検証は 1018 tests passed / svelte-check 0 errors。

### 🔴 M-2 の設計欠陥: 冪等化がイベントを永久消失させていた

初回の実装（migration 1030）は本処理の**前**に INSERT し、その瞬間から同じ `event.id` を
処理済みと判定していた。失敗時は catch で行を削除する作りだったため、**catch を通らない終了**を
考慮できていなかった:

```
INSERT 成功 → 本処理中に Vercel の maxDuration(10s) 超過 / プロセス強制終了 / デプロイ
→ Stripe が再送 → 一意制約違反 → 「処理済み」と判定 → 二度と処理されない
```

`svelte.config.js` の `maxDuration` は **10 秒**で、組織アップグレード経路は Stripe の
`subscriptions.list()` + 複数 `cancel()` を伴うため、現実的な確率で踏む。

**migration 1031** で状態とリース期限を導入した:

| 状態 | 意味 | 再処理 |
|---|---|---|
| `processing` | 処理中。`claimed_at` からリース(60秒)が生きている間だけ有効 | リース切れなら**再取得可** |
| `completed` | 正常終了 | 永久スキップ |
| `dropped` | 再送しても成功しないため破棄（dead-letter） | 永久スキップ |

- 永久スキップするのは **completed と dropped だけ**
- リース期間 `LEASE_MS = 60_000` は `maxDuration`(10秒) の6倍という根拠をコードに明記。上限を伸ばすときは必ず見直す
- リース奪取は**条件付き UPDATE**（`status='processing' AND claimed_at < cutoff`）で影響行数により勝者を決める。SELECT→UPDATE では同時配信で二重処理になる
- 回帰テスト: `stripe.webhook.idempotency.test.ts`（12件）。「リース切れ再取得」「先着競合」「解放失敗」を含む

### 🔴 H-4: プラン変更で未決済のまま権限が上がっていた（新規発見）

`change-plan` の `subscriptions.update()` に `payment_behavior` が無く、既定の
`allow_incomplete` のままだった。**テストモードで実測**した結果:

| payment_behavior | 結果 |
|---|---|
| 未指定（既定 = `allow_incomplete`） | **API は成功**し `status: past_due` を返す。請求書は `open` のまま未払い |
| `error_if_incomplete` | 402 `card_declined` で例外 → アプリの catch が `fail(500)` |

戻り値を無条件に DB へ反映していたため、**未決済のまま上位プランが有効**になっていた。
API が例外を投げないので try/catch だけでは検知できない。

対応: `payment_behavior: 'error_if_incomplete'` を指定し、多層防御として**戻り値の status でも門番**した。
ただし門番は**請求が発生する経路にのみ**掛ける（`proration_behavior === 'always_invoice'` のとき）。
支払いが滞っている顧客の「格下げ」まで止めるのは不利益なうえ、権限が上がるわけでもないため。
この意図もテストで固定した。

### 🟠 テストが例外を握り潰していた

`change-plan.action.test.ts` の2箇所が `catch {}` で例外を捨てており、Stripe 呼び出し後に
DB 更新が失敗してもテストが通る状態だった。`expect.fail('Expected redirect')` +
status / location の明示検証に変更した。

### 🟠 200破棄イベントの追跡可能性

破棄理由がログにしか残らず、ログが失われると再処理の手がかりが無かった。
`failure_reason` 列を追加し、**`status='dropped'` の行が dead-letter レコード**になる。
payload は保存しないが `event_id` から `stripe.events.retrieve()` で再構築できる。
運用監視のクエリは `verify/1031_verify_stripe_events.sql` の (D)(E) にまとめた。

### 🟡 Price ID 整合テストの自己参照

ユニットテストが「DBが許可する plan_type」を手書きで持っており、実DBのドリフトを検知できなかった。
ネットワークが要る突合を **`npm run verify:plan-consistency`** に分離した（plan_limits の行の有無、
`ORG_PLANS.maxMembers` との一致、.env の price ID が Stripe に実在し有効な定期課金であること）。

**限界を明記しておく**: `subscriptions.plan_type` / `status` の CHECK 制約そのものは、
PostgREST から `pg_constraint` を読めないためこのスクリプトでは検査できない。
それは `verify/1029_verify_status_check.sql` を SQL Editor（または MCP）で実行して確認する。
ユニットテスト側の手書き配列は「コード側が DB の想定を超える値を返さない」という
一方向の不変条件に限定する旨をコメントで明示した。

### 検証実行の記録（2026-08-04・prod / dev 両方）

| verify | prod | dev |
|---|---|---|
| 1029（status CHECK 8値・不適合0件・部分一意索引との整合） | ✅ | ✅ |
| 1031（RLS有効/ポリシー0・状態3値が通り不正値は拒否・dropped 0件・stale processing 0件） | ✅ | ✅ |

---

## 追加対応（2026-08-04・監査項目外）

### 無償提供（¥0請求）では契約期間が更新されない — ✅ 修正

本番データ調査の副産物として発見。**テストモードで実測**したところ、100%割引の
サブスクリプションでは Stripe が決済を行わないため `invoice.payment_succeeded` を送らず、
`invoice.paid` だけを送っていた。

```
発火したイベント: invoice.paid / invoice.finalized / invoice.created
                  customer.subscription.created
発火しなかった  : invoice.payment_succeeded   ← アプリが購読していたのはこちら
```

`current_period_end` を進めるのは `handlePaymentSucceeded` だけなので、クーポンで無償提供した
アカウントは契約期間が初回のまま永久に更新されない。さらにリプレイ防御（古いイベントはスキップ）が
働いて後続イベントまで弾かれ得る。

対応: `invoice.paid` を同じハンドラへ流す。有償時は両方届くが `event.id` が異なり冪等化では
弾けないため、リプレイ防御が二重反映を防ぐことをテストで固定した。

⚠️ **Stripe ダッシュボード側でエンドポイントの購読イベントに `invoice.paid` を追加する必要がある。**
コードだけではイベントが届かない。

### ユーザーが自分の支払い状態を確認できない — ✅ 対応

UI は `plan_type` しか出しておらず、**`status` を表示する画面が1つも無かった**
（`past_due` / `unpaid` / `incomplete` を扱う .svelte は 0 件）。
そのため「支払われている premium」と「支払いが滞っている premium」を区別できない。

とくに `past_due` はアプリ側で `ENTITLED_STATUSES` として上位プランの権限を維持する猶予期間
として扱うため、当人は気づかないまま使い続け、猶予切れの瞬間に free へ落ちてメンバーが
締め出される。**気づいて対処する機会が無い**のが問題だった。

対応: `BillingStatusBadge` を追加し、`/organization/[id]` に表示する。

- 表示ポリシーは `SyncStatusBadge` と揃え、**正常時（active/trialing かつ解約予定なし）は何も出さない**
- 対象: `past_due` / `unpaid` / `incomplete` / `incomplete_expired` / `paused` / 解約予定
- `canceled` は既に free へ降格済みなので出さない
- 支払い方法の修正は Stripe Customer Portal へ誘導（カード情報を自前で扱わない）
- **管理者にのみ表示**。一般メンバーは支払い方法を直せる立場になく、見せる必要も無い

実装上の注意: `subscriptions` の SELECT ポリシーは `auth.uid() = user_id` のため、
契約者本人以外の管理者はユーザークライアントで読めない。role を確認したうえで service role で引いている。
