-- ============================================================================
-- 一回限りのデータ修正（2026-08-05）
-- 組織「SAJ デモンストレータープロモートチーム」を「請求なしの premium」に確定させる
-- ============================================================================
-- ⚠️ これはマイグレーションではなく、特定の1行を直す運用スクリプト。再利用しないこと。
--
-- WHY:
--  2026-03-10 のアップグレード（Stripe で ¥43,260 課金済み）が DB に反映されなかった。
--  当時の change-plan アクションはユーザークライアントで書き込んでおり、
--  subscriptions には UPDATE ポリシーが無いため PostgREST が
--  **エラーではなく「0行更新」**を返し、画面上は成功したまま DB だけ取り残された
--  （このアプリ側の欠陥は 2026-07-03 の 7f5829d で supabaseAdmin 化して修正済み）。
--
--  結果、実態と DB が次のように食い違っている:
--    Stripe        : 契約は既に存在しない（2026-03-10 以降の請求なし）
--    organizations : plan_type=premium（03/10 の課金内容と一致・11名が利用中）
--    subscriptions : status=active / plan_type=basic / period_end=2026-04-02（3月2日時点のまま）
--
--  `status=active` かつ存在しない stripe_subscription_id が残っていると実害がある:
--    - change-plan は subscriptions.retrieve() が resource_missing で 500 になる
--    - upgrade ページは「契約済み」と判定して /account へ弾く
--    - 削除ページが誤って「有効な契約あり」と表示する
--
-- WHAT:
--  (1) subscriptions を **handleSubscriptionDeleted と同じ形**に揃える。
--      アプリが正常に動いていれば到達していたはずの状態にするだけで、独自の状態は作らない。
--  (2) organizations の plan_type は **premium のまま据え置く**（自社パイロットとして無償提供）。
--      通常の解約処理は free へ降格させるが、ここは意図的に行わない。
--  (3) 存在しない契約への参照（organizations.stripe_subscription_id）だけ外す。
--      stripe_customer_id は残す（将来 再契約する際に同じ Customer を再利用できる）。
--
-- 据え置いても自動降格しないことは確認済み:
--  - 上限判定は organizations.plan_type → plan_limits のみ。subscriptions は関与しない
--  - plan_type を書き換えるのは Stripe webhook だけで、契約が無い以上イベントは発生しない
--  - vercel.json の crons は空。棚卸しのバッチも無い
--
-- 適用対象: **prod (scoring-system) のみ**。dev には該当データが無い。
-- ============================================================================

BEGIN;

-- 対象の確認（実行前に目視すること。1行だけ返るはず）
--   select id, name, plan_type, max_members, stripe_subscription_id
--   from organizations where id = '805ae237-9113-412a-9df3-05bb75da7586';

-- (1) subscriptions を実態（Stripe に契約なし）へ合わせる
--     handleSubscriptionDeleted と同一の更新内容
UPDATE subscriptions
SET plan_type = 'free',
    status = 'canceled',
    stripe_subscription_id = NULL,
    organization_id = NULL
WHERE stripe_subscription_id = 'sub_1T6UbIIsuW568CJsIVmVaHHg';

-- (2) organizations: plan_type / max_members は premium のまま**触らない**。
--     存在しない契約への参照だけ外す（stripe_customer_id は残す）
UPDATE organizations
SET stripe_subscription_id = NULL
WHERE id = '805ae237-9113-412a-9df3-05bb75da7586'
  AND stripe_subscription_id = 'sub_1T6UbIIsuW568CJsIVmVaHHg';

COMMIT;

-- ============================================================================
-- 適用後の確認
-- ============================================================================
-- 期待: organizations は premium/100 のまま、stripe_subscription_id は null。
--       この組織に紐づく active/trialing な subscriptions は 0 件。
--
--   select o.name, o.plan_type, o.max_members, o.stripe_subscription_id,
--          o.stripe_customer_id is not null as has_customer,
--          (select count(*) from subscriptions s
--             where s.organization_id = o.id and s.status in ('active','trialing')) as active_subs
--   from organizations o
--   where o.id = '805ae237-9113-412a-9df3-05bb75da7586';
--
-- 無償提供をやめる場合は、通常の Checkout から再契約すれば webhook が
-- organizations / subscriptions の両方を正しい状態に更新する。
-- ============================================================================
