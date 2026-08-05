# Stripe 決済 再監査（2026-08-05）

> **対応状況（2026-08-05）**: P0-A / P0-B / P1-C / P1-D および P2-E / P2-G / P2-H / P3-I / P3-J は修正済み。
> 回帰テストは `src/lib/server/__tests__/stripe.audit-2026-08-05.test.ts`（9件）。
> migration 1035 は dev / prod ともに適用済みで、本番実測で効果を確認した。
> **P2-F のみ未対応**（判断が必要なため。末尾を参照）。

前回監査（`stripe-audit-2026-08-04.md`）の修正適用後に、決済経路を改めて全件検証した記録。
前回は「webhook の受信・冪等性・API バージョン差分」が中心だったが、今回は
**RLS と実データを突き合わせる**ところまで踏み込んだ結果、前回見えていなかった層の欠陥が出た。

## 検証方法

机上のコードレビューではなく、以下の実行可能な証拠で裏付けた。

1. 仮説を再現する探索テストを書き、**現行コードで落ちること**を確認（P0-B / P1-D）
2. **本番 DB に対して RLS を実際に切り替えて**可視性と書き込み結果を計測（P0-A / P1-C）
3. `pg_constraint` / `pg_indexes` / `pg_policies` の実体をスキーマ前提の根拠として参照

## 現況（本番）

| 項目 | 値 |
| --- | --- |
| 組織 | 8（free 7 / premium 1） |
| subscriptions | 2 行（いずれも canceled） |
| stripe_events | 0 行（本番稼働イベントはまだ無い） |
| 課金中の顧客 | **0** |

premium の 1 件は SAJ 組織の自社パイロット（請求なしの据え置き、`stripe_subscription_id` は null）。

**現時点で金銭的被害は発生していない。** 以下はすべて「最初の有料契約が入った時点で顕在化する」欠陥である。
逆に言えば、**課金を開始する前が修正の最終期限**になる。

---

## P0-A: 契約者以外の管理者はプラン管理ができず、重複契約を作れてしまう

**影響: 二重課金 + 前払い分の失効**

`subscriptions` の RLS は SELECT ポリシーが `auth.uid() = user_id` の 1 本だけで、
**組織スコープのポリシーが存在しない**。行の `user_id` は「checkout を開始した本人」なので、
同じ組織の別の管理者からはサブスクリプション行が**存在しないように見える**。

本番 DB で実測（SAJ 組織）:

| 実行者 | 見える行数 | UPDATE の影響行数 |
| --- | --- | --- |
| 契約者本人 | 1 | — |
| 同組織の別メンバー | **0** | **0（エラーなし）** |

これが 2 つの経路で問題になる。

1. **プラン変更・解約の不能**
   `change-plan` は `subscriptions` を user client で引くため、契約者以外の管理者には
   「アクティブなサブスクリプションが見つかりません」となり、変更も解約もできない。
2. **重複契約（本命）**
   `/organization/[id]/upgrade` の「既に契約済みならリダイレクト」判定も同じクエリ。
   契約者以外の管理者には**契約が無いように見えるためガードが素通りし**、2 本目の
   サブスクリプションを作れてしまう。

2 本目が完了すると webhook（`is_upgrade=true`）が旧サブスクを
`stripe.subscriptions.cancel()` で即時解約する。この解約は**日割り返金を伴わない**ため、
旧プランの前払い分はそのまま失効する。`change-plan` 経由なら `always_invoice` で未使用分が
クレジットされるのと対照的で、**同じ「上位プランへの変更」が経路によって顧客の損得を変える**。

さらに `/api/stripe/upgrade-organization` は `subscriptions` を一度も参照しない
（`grep` で 0 件）。ページ側のガードだけが頼りで、**API 単体には重複契約の防御が無い**。
古いタブからの POST でも同じことが起きる。

現状は全組織が管理者 1 名のため未発現。SAJ は 11 名在籍で管理者 1 名なので、
**2 人目の管理者を任命した時点で踏む**。

### 対応方針

- `subscriptions` に組織スコープの SELECT ポリシーを追加（`is_organization_admin(organization_id)`）
- 併せて、課金系の読み取りはサーバー側で `supabaseAdmin` に寄せる（RLS の穴に依存しない）
- `/api/stripe/upgrade-organization` に「既にアクティブな契約があれば 409」を**サーバー側で**追加

---

## P0-B: `customer.subscription.created` が決済確定ゲートを迂回する

**影響: 未決済のまま上位プランの権限が付与される**

前回監査の H-2 で `handleCheckoutCompleted` には
「`incomplete` 等の未確定ステータスでは `organizations.plan_type` を上げない」ゲートを入れた。
しかし `handleSubscriptionCreated`（`subscription.ts:93-124`）には**同じゲートが無く**、
`subscription.status` を一切見ずに `organizations.plan_type` / `max_members` を更新する。

探索テストで再現（現行コードで失敗する）:

```
イベント: customer.subscription.created (status = incomplete)
ログ:     [Webhook] organizations更新成功: org_1 plan_type: premium max_members: 100
```

`customer.subscription.created` は通常 `checkout.session.completed` より先に届き、
その時点では `subscriptions` 行が無いため `RetryableError` で再送される。
再送が届く頃には checkout 側が行を作り終えており、**そこで無条件に昇格が走る**。
つまり H-2 のゲートは実質的に無効化されている。

`organizations.plan_type` は `getOrganizationPlanLimits()` が参照する権限の実体なので、
これはそのまま「払っていないのに Premium の上限が使える」状態になる。

### 対応方針

`handleSubscriptionUpdated` と同じく `isEntitledStatus()` で門番する
（`shared.ts` に既にある共通関数をそのまま使えばよい）。

---

## P1-C: 組織削除の subscriptions 書き込みが黙って失敗する

**影響: Stripe と DB の乖離（3月の障害と同じ根本原因）**

`organization/[id]/delete/+page.server.ts` の delete アクションは
`locals: { supabase }` しか受け取っておらず、以下を**user client**で実行している。

| 行 | 操作 |
| --- | --- |
| 219 | `subscriptions.update({ status: 'canceled', ... })` |
| 247 | `subscriptions.delete()` |

`subscriptions` は RLS 有効で **UPDATE / DELETE ポリシーが 0 本**。
PostgREST は権限で弾かれた更新を**エラーではなく「0 行」として返す**ため、
`subscriptionDeleteError` は null になり、コードは成功ログを出して次へ進む。

本番実測でも UPDATE は `0 行 / エラーなし` だった。

これは 2026-03-10 に `change-plan` で起きた事故（organizations だけ premium になり
subscriptions が basic のまま残った）と**まったく同じ失敗の形**で、
その時は change-plan だけを `supabaseAdmin` に直したため、delete 経路が取り残されている。

Stripe 側の解約自体は成功するので**過剰請求は起きない**。残るのは
`organization_id` が null になった status='active' の孤児行で、
`customer.subscription.deleted` webhook が届けば自己修復する。実害は限定的だが、
「成功したと報告して実際は何もしていない」ため次の事故を見逃す土壌になる。

### 対応方針

delete アクションで `locals.supabaseAdmin` を受け取り、`subscriptions` への書き込みを移す
（`change-plan` と同じ SEC-3 の方針。`hooks.server.ts:43` で既に注入済み）。

---

## P1-D: プラン変更の増減判定が `organizations.plan_type` 由来で、ドリフトに弱い

**影響: 増額変更が「日割り請求なし」で通る（過少請求）**

`change-plan` の `isPlanUpgrade()` は `organizations.plan_type` を現行プランとして使う。
これは Stripe の実体ではなく**アプリ側のキャッシュ**であり、実際に過去ドリフトした列でもある
（SAJ 組織は今まさに `organizations.plan_type = premium` / 課金実体なし）。

探索テストで再現（現行コードで失敗する）:

```
Stripe の実体: price_basic_month（basic 月額）
organizations: premium（ドリフト）
変更操作:      standard 月額へ
結果:          isUpgrade=false → prorationBehavior: 'none'
期待:          basic→standard は増額 → 'always_invoice'
```

`proration_behavior: 'none'` は差額を請求しないため、**上位プランを即時に使えるのに
次回更新まで支払いが発生しない**。同時に `payment_behavior: 'error_if_incomplete'` の
決済確認も通らない（請求が起きないため）ので、H-4 の多層防御も効かない。

同じ関数の直前で `stripe.subscriptions.retrieve()` を呼び、
`items.data[0].price.id` から請求間隔を取っている。**現行プランも同じ場所から取れる**ので、
修正は小さい。

### 対応方針

`findPlanTypeByPriceId(stripeSubscription.items.data[0].price.id)` を現行プランの正とし、
`organizations.plan_type` は表示用に留める。「同一プラン・同一間隔」の重複判定も同様。

---

## P2 以下（記録）

| ID | 内容 | 影響 |
| --- | --- | --- |
| P2-E | `handlePaymentSucceeded` が `status: 'active'` を固定で書く。`stripe.subscriptions.retrieve()` の実ステータスを取得済みなのに使っていない | 未払いが別に残っていても DB は active になる。past_due も権限ありなので実害は表示のみ |
| P2-F | 未知の price ID が `RetryableError` → 3日間再送し続けエンドポイント自動無効化の恐れ。**Stripe ダッシュボードで手動作成したサブスクや、Portal でのマッピング外価格への変更**で踏む | 他の正当なイベントを巻き添えで失う |
| P2-G | `handleSubscriptionCreated` にリプレイ/順序ガードが無い（`updated` 側にはある） | 遅延再送が新しいプラン変更を巻き戻し得る |
| P2-H | リプレイ防御が `period_end` の後退を「古いイベント」として一律スキップする。年額→月額は `anchor: 'now'` で period_end が前進しないため**必ずスキップされる** | webhook が保険にならず、サーバーアクションの DB 書き込み成功に全依存 |
| P3-I | 個人プラン経路の `upsert(onConflict: 'user_id')` に対応する一意制約が本番に無い（`idx_subscriptions_user_id` は非 UNIQUE） | 到達したら 42P10 で 500 ループ。現状 `is_organization` は常に `'true'` のため到達不能 |
| P3-J | `upgrade-organization:138` の `stripe_customer_id` 書き込みが user client かつエラー未確認 | 失敗時に Stripe 上の孤児 Customer が増える |

## 問題なしを確認した項目

- 署名検証（`constructEventAsync`）、livemode 不一致の扱い
- 冪等化のリース方式（processing / completed / dropped、60 秒リース）
- API バージョン差分の吸収（`getSubscriptionPeriod` / `getInvoiceSubscriptionId`）
- `invoice.paid` と `invoice.payment_succeeded` の二重受信 → 同一内容スキップで二重反映なし
- checkout / upgrade / portal の認可（すべて `isOrgAdmin` 経由・退会済み除外済み）
- リダイレクト URL 検証、クーポンの promotion code 限定、レート制限
- 価格 ID の単一ソース化（`$lib/server/plans`）と `plan_limits` 参照の一本化
- `subscriptions_organization_active_unique`（部分一意）による「1 組織 1 アクティブ契約」のDB保証

---

## 実装後の再検証（2026-08-05）

修正をコミットしたあと、**入れた修正自体を敵対的に見直した**。3件の追加問題が出た。
いずれも先に落ちるテストで再現してから直している。

### R-1（自分が入れた退行）決済未確定を `free` と書くと、支払っている組織が降格する

`handleSubscriptionCreated` の P0-B 対応で `isEntitledStatus(...) ? planType : 'free'` としたが、
これは**未確定を「free 相当」と解釈**してしまっている。このイベントは
「新しい契約が生まれた」ことしか意味せず、組織が今どの契約で権限を得ているかは別問題。

再現条件: 猶予期間中（past_due）の契約を持つ組織に2本目の未確定契約が生まれる。
`free` を書いた瞬間に**支払っている組織が free に降格**する。
（P0-A の重複契約ガードは active/trialing のみを弾くため、past_due の組織はこの経路に入れる。
　past_due を弾かないのは意図的で、change-plan も active/trialing しか拾わないため
　弾くと復帰手段が無くなる。）

→ 未確定なら昇格も降格もせず、`organizations` に触らないようにした。
　 決済が確定すれば `customer.subscription.updated` が正しい状態へ持っていく。

### R-2 ドリフト時に、正当なアップグレードを「既に同じプラン」で弾いていた

P1-D で増減判定は Stripe の price 由来にしたが、その手前の
「プランタイプと請求間隔の両方が同じならエラー」は `organizations.plan_type` のままだった。
実体が basic・organizations が premium の組織で premium を選ぶのは正当なアップグレードなのに、
「既に同じプラン・請求間隔を利用中です」で弾かれる（＝払う意思のある顧客を止める）。

→ 判定を Stripe の実体取得後に移し、`currentPlanType` / `currentBillingInterval` と比較する。

### R-3 migration 1035 が、複数行を前提にしていない読み取りを露出させた

`organizations.plan_type` の可視範囲が広がった副作用。再契約すると解約済みの行が
`organization_id` を保持したまま残るため、1組織が複数行を持ち得る。
これまでは「契約者本人の行しか見えない」ことが偶然の防御になっていたが、
組織管理者が全行を読めるようになって消えた。PostgREST の `maybeSingle()` / `single()` は
**複数行でもエラー**になるので、前提を置いた箇所は黙って既定値に戻る。

- `pricing/+page.server.ts`: 請求間隔の表示が既定へ戻る
- `organization/[id]/delete/+page.server.ts` (load): 「解約されます」の警告が消え、
  管理者が課金の存在に気づかないまま組織を削除し得る

→ 既に `organization/[id]/+page.server.ts` が同じ罠を記録して
　 `.order(created_at desc).limit(1)` で回避していたので、同じ形に揃えた。

### 再検証で問題なしを確認した項目

- `isStaleSubscriptionEvent` の各経路（更新・請求成功・請求失敗・created）
- P2-E で書く status が `subscriptions_status_check` の8値に必ず収まること
  （Stripe のサブスクリプションステータスは同じ8種）
- 課金テーブルへの読み取り全21箇所が `organization_id` / `user_id` /
  `stripe_subscription_id` のいずれかで絞られており、無条件 `.single()` が無いこと
- past_due の組織が 409 ガードで詰まないこと（唯一の復帰経路を塞がない）
