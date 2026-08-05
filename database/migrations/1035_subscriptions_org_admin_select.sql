-- ============================================================================
-- 1035: subscriptions に組織管理者向けの SELECT ポリシーを追加
-- ============================================================================
-- 監査: docs/stripe/stripe-audit-2026-08-05.md（P0-A）
--
-- 【問題】
-- subscriptions の SELECT ポリシーは `auth.uid() = user_id` の1本だけだった。
-- この user_id は「Checkout を開始した本人」であり、組織の所有者ではない。
-- そのため**契約者以外の管理者からは、組織の契約が存在しないように見えていた**。
--
-- 本番 DB で実測（SAJ 組織）:
--   契約者本人         → 1 行見える
--   同組織の別メンバー → 0 行（UPDATE も 0 行・エラーなし）
--
-- これが 2 つの経路で実害になる。
--   1. change-plan がプラン変更・解約ともに
--      「アクティブなサブスクリプションが見つかりません」で機能しない
--   2. /organization/[id]/upgrade の「契約済みならリダイレクト」ガードが素通りし、
--      2 本目のサブスクリプションを作れてしまう（＝二重課金）。
--      2 本目が完了すると webhook が旧サブスクを日割り返金なしで即時解約するため、
--      旧プランの前払い分がそのまま失効する。
--
-- 【方針】
-- 組織に紐づく契約は、その組織の**アクティブな管理者**なら読めるようにする。
-- is_organization_admin() は SECURITY DEFINER かつ `removed_at IS NULL` を見るため、
-- 退会済みの管理者には権限が戻らない。
--
-- ⚠️ **書き込みポリシーは追加しない。**
-- subscriptions への INSERT/UPDATE/DELETE は webhook とサーバーアクションが
-- service role で行う設計（SEC-3）。ポリシーを足すと、ユーザー操作で課金状態を
-- 書き換える経路が生まれる。「書き込みポリシーが 0 本であること」自体が仕様なので、
-- ここを緩めないこと。
--
-- 冪等。prod / dev の両方に適用する。
-- ロールバック: rollbacks/1035_rollback.sql
-- ============================================================================

do $$
begin
	if to_regprocedure('public.is_organization_admin(uuid)') is null then
		raise exception 'is_organization_admin(uuid) がありません。先に組織 RLS の migration を適用してください。';
	end if;
end $$;

drop policy if exists "authed_subscriptions_select_by_org_admin" on public.subscriptions;

create policy "authed_subscriptions_select_by_org_admin"
	on public.subscriptions
	for select
	to authenticated
	using (
		organization_id is not null
		and public.is_organization_admin(organization_id)
	);

-- 適用後の期待値:
--   subscriptions の SELECT ポリシーが 2 本（本人 + 組織管理者）
--   INSERT / UPDATE / DELETE ポリシーは 0 本のまま
