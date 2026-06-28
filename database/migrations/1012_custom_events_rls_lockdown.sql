-- ============================================================================
-- Migration 1012: custom_events の越境 write/delete を塞ぐ（RLS ロックダウン）
-- ============================================================================
-- WHY: prod/dev は custom_events に authed INSERT/UPDATE/DELETE = true（029）＋
--      anon SELECT = true（037-039）が残存 → 任意の認証ユーザーが他org/他セッションの
--      種目を改ざん・削除でき、anon は全種目を越境閲覧できる。
-- WHAT: 書込みを「session の creator / chief / org メンバー」にスコープし、
--       anon SELECT を JWT の session_id に限定する。
-- NOTE: authed SELECT(=true) は本バッチでは触らない（READ Med 群は別バッチ）。
--       公開 scoreboard は service-role 経由（RLS バイパス）なので影響なし。
-- 冪等。DEV 先行 → prod。問題時は 1012_rollback.sql。
-- ============================================================================

begin;

-- 非再帰ヘルパー（無ければ作成。既存ならそのまま使う＝param 名ドリフトの 42P13 を回避）。
-- organization_members を SECURITY DEFINER で直接参照するので org_members の RLS に依存しない。
do $$
begin
  if not exists (select 1 from pg_proc where proname = 'is_organization_member') then
    create function public.is_organization_member(org_id uuid, check_user_id uuid)
    returns boolean language plpgsql security definer as $fn$
    begin
      return exists (
        select 1 from public.organization_members
        where organization_id = org_id
          and user_id = check_user_id
          and removed_at is null
      );
    end;
    $fn$;
  end if;
end $$;

-- 過剰ポリシーを撤去
drop policy if exists "Authenticated users can insert custom events" on public.custom_events;
drop policy if exists "Authenticated users can update custom events" on public.custom_events;
drop policy if exists "Authenticated users can delete custom events" on public.custom_events;
drop policy if exists "Anonymous users can view custom events" on public.custom_events;

-- 書込み（authed）: session の creator / chief / org メンバーのみ
create policy "authed_custom_events_insert_by_session_manager"
  on public.custom_events for insert to authenticated
  with check (
    exists (
      select 1 from public.sessions s
      where s.id = custom_events.session_id
        and (
          s.created_by = auth.uid()
          or s.chief_judge_id = auth.uid()
          or public.is_organization_member(s.organization_id, auth.uid())
        )
    )
  );

create policy "authed_custom_events_update_by_session_manager"
  on public.custom_events for update to authenticated
  using (
    exists (
      select 1 from public.sessions s
      where s.id = custom_events.session_id
        and (
          s.created_by = auth.uid()
          or s.chief_judge_id = auth.uid()
          or public.is_organization_member(s.organization_id, auth.uid())
        )
    )
  )
  with check (
    exists (
      select 1 from public.sessions s
      where s.id = custom_events.session_id
        and (
          s.created_by = auth.uid()
          or s.chief_judge_id = auth.uid()
          or public.is_organization_member(s.organization_id, auth.uid())
        )
    )
  );

create policy "authed_custom_events_delete_by_session_manager"
  on public.custom_events for delete to authenticated
  using (
    exists (
      select 1 from public.sessions s
      where s.id = custom_events.session_id
        and (
          s.created_by = auth.uid()
          or s.chief_judge_id = auth.uid()
          or public.is_organization_member(s.organization_id, auth.uid())
        )
    )
  );

-- anon SELECT: 自分の JWT session_id のみ（ゲスト採点で種目を読む。越境閲覧は不可）
create policy "anon_custom_events_select_by_jwt"
  on public.custom_events for select to anon
  using (
    session_id = NULLIF((auth.jwt() -> 'user_metadata' ->> 'session_id'), '')::bigint
  );

commit;

-- 検証
select policyname, cmd, roles::text as roles
from pg_policies
where schemaname = 'public' and tablename = 'custom_events'
order by cmd, policyname;
