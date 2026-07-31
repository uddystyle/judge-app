-- ============================================================================
-- Migration 1022: tournament_tickets（大会スポット販売チケット）+ DB 層強制
-- ============================================================================
-- WHY: 大会モードを plan_limits.has_tournament_mode（プラン特典）から切り出し、
--      「大会1回 = セッション1つ」のスポット販売（個別見積り・手動請求）にする。
--      運営が見積合意後に service role でチケットを付与し、大会モードの
--      セッション作成時に自動消費する。
--      アプリ層のチェックだけでは sessions の INSERT/UPDATE ポリシー
--      （018_organization_based_rls.sql: 組織メンバーなら任意カラムで書ける）を
--      PostgREST 直叩きで迂回できるため、消費は BEFORE INSERT トリガーで
--      DB 層において原子的に強制する（1006 の会員上限トリガーと同方針）。
-- WHAT:
--   1. tournament_tickets テーブル新設
--      - RLS: 組織メンバーは自組織分の SELECT のみ。INSERT/UPDATE/DELETE
--        ポリシーは作らない（付与・訂正は service role = RLS バイパス）。
--   2. sessions BEFORE INSERT トリガー: 大会モードの insert 時に未使用チケットを
--      FOR UPDATE SKIP LOCKED で1枚消費。無ければ例外で insert 拒否。
--      同時作成の競合・「チェックと消費の非アトミック」問題も同時に解決。
--      service role / SQL Editor 経由の insert にも適用（意図的。検証時は
--      先にチケットを INSERT すること）。
--   3. sessions BEFORE UPDATE トリガー: authenticated/anon による既存セッションの
--      大会化（is_tournament_mode/mode の書き換え）を拒否（チケット迂回防止）。
-- NOTE: チケットは soft delete では返却しない（削除→復元の無償再利用防止）。
--       大会中止等の返却は運営が service role で新規付与して対応する。
-- 冪等。DEV 先行 → prod。問題時は rollbacks/1022_rollback.sql。
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. テーブル
-- ----------------------------------------------------------------------------
create table if not exists public.tournament_tickets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  session_id bigint,                  -- 消費時にセット（未使用は null）
  note text,                          -- 見積/請求メモ（大会名・Stripe Invoice 番号等）
  granted_at timestamptz not null default now(),
  used_at timestamptz,
  -- session_id が入っているなら必ず消費済み。
  -- 「used_at あり・session_id null」はセッション物理削除（FK set null）後の状態として許容。
  constraint tournament_tickets_used_consistency
    check (used_at is not null or session_id is null)
);

-- FK（pg_constraint 存在チェックで冪等）
do $$
begin
  -- 組織FK: cascade にしない（請求監査データのため）。組織削除時にチケット行が
  -- あると restrict で失敗する — 運営が service role でチケットを整理してから
  -- 削除する運用（docs/tournament-tickets-ops.md）。
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.tournament_tickets'::regclass
      and conname = 'tournament_tickets_organization_id_fkey'
  ) then
    alter table public.tournament_tickets
      add constraint tournament_tickets_organization_id_fkey
      foreign key (organization_id) references public.organizations(id) on delete restrict;
  end if;

  -- sessions は cron（delete_expired_archived_sessions）と permanent API で物理削除される
  -- ため、restrict ではなく set null（チケットは消費済みのまま監査行として残る）。
  -- ★ deferrable initially deferred が必須:
  --   消費トリガー（BEFORE INSERT）は sessions 行がヒープに入る前に session_id を
  --   書くため、即時 FK 検査だと必ず 23503 で失敗する。遅延検査により
  --   トランザクション commit 時（sessions 行確定後）に検査される。
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.tournament_tickets'::regclass
      and conname = 'tournament_tickets_session_id_fkey'
  ) then
    alter table public.tournament_tickets
      add constraint tournament_tickets_session_id_fkey
      foreign key (session_id) references public.sessions(id) on delete set null
      deferrable initially deferred;
  end if;
end $$;

create index if not exists idx_tournament_tickets_org
  on public.tournament_tickets (organization_id);
create index if not exists idx_tournament_tickets_org_available
  on public.tournament_tickets (organization_id) where used_at is null;
-- 1セッション = 1チケットを DB で強制
create unique index if not exists tournament_tickets_unique_session
  on public.tournament_tickets (session_id) where session_id is not null;

-- ----------------------------------------------------------------------------
-- 2. RLS（SELECT のみ。書込みポリシーは意図的に作成しない = service role 専用）
-- ----------------------------------------------------------------------------
alter table public.tournament_tickets enable row level security;

-- is_organization_member は 052 で dev+prod 適用確認済み。無い DB でも動くよう 1012 と同じガード。
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

drop policy if exists "authed_tournament_tickets_select_by_org_member" on public.tournament_tickets;
create policy "authed_tournament_tickets_select_by_org_member"
  on public.tournament_tickets for select to authenticated
  using (public.is_organization_member(organization_id, auth.uid()));

-- ----------------------------------------------------------------------------
-- 3. BEFORE INSERT: 大会セッション作成時にチケットを原子消費
-- ----------------------------------------------------------------------------
create or replace function public.consume_tournament_ticket()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ticket_id uuid;
begin
  -- WHEN 句でも絞っているが二重防御
  if not (coalesce(new.is_tournament_mode, false) or new.mode = 'tournament') then
    return new;
  end if;

  -- 未使用チケットを1枚ロックして取得。skip locked により同時作成は
  -- 別々のチケットを掴む（残1枚に2リクエストなら片方が例外で敗退）。
  select id into v_ticket_id
  from public.tournament_tickets
  where organization_id = new.organization_id
    and used_at is null
  order by granted_at
  limit 1
  for update skip locked;

  if v_ticket_id is null then
    raise exception 'TOURNAMENT_TICKET_REQUIRED: 大会モードの利用には大会チケットが必要です'
      using errcode = 'P0001',
            hint = '大会モードのご利用はお問い合わせください（スポット販売）';
  end if;

  -- bigserial の default は BEFORE トリガー実行前に評価されるため new.id は採番済み。
  -- 外側の INSERT が失敗した場合はトランザクションごと巻き戻る（消費もアトミックに取消）。
  update public.tournament_tickets
  set used_at = now(), session_id = new.id
  where id = v_ticket_id;

  return new;
end;
$$;

drop trigger if exists trg_consume_tournament_ticket on public.sessions;
create trigger trg_consume_tournament_ticket
  before insert on public.sessions
  for each row
  when (new.is_tournament_mode is true or new.mode = 'tournament')
  execute function public.consume_tournament_ticket();

-- ----------------------------------------------------------------------------
-- 4. BEFORE UPDATE: 既存セッションの大会化を拒否（authenticated/anon のみ）
-- ----------------------------------------------------------------------------
create or replace function public.prevent_tournament_mode_escalation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (coalesce(new.is_tournament_mode, false) and not coalesce(old.is_tournament_mode, false))
     or (new.mode = 'tournament' and old.mode is distinct from 'tournament') then
    -- service role（運営オペ）と SQL Editor（auth.role() = null）は許可
    if auth.role() in ('authenticated', 'anon') then
      raise exception 'TOURNAMENT_MODE_CHANGE_FORBIDDEN: 既存セッションを大会モードに変更することはできません'
        using errcode = 'P0001',
              hint = '大会モードのご利用はお問い合わせください（スポット販売）';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_prevent_tournament_mode_escalation on public.sessions;
create trigger trg_prevent_tournament_mode_escalation
  before update on public.sessions
  for each row
  when (
    new.is_tournament_mode is distinct from old.is_tournament_mode
    or new.mode is distinct from old.mode
  )
  execute function public.prevent_tournament_mode_escalation();

commit;

-- ----------------------------------------------------------------------------
-- 検証
-- ----------------------------------------------------------------------------
-- (a) テーブル・ポリシー
select policyname, cmd, roles::text as roles
from pg_policies
where schemaname = 'public' and tablename = 'tournament_tickets'
order by cmd, policyname;
-- 期待: authed_tournament_tickets_select_by_org_member (SELECT, {authenticated}) の1行のみ

-- (b) トリガー
select tgname, tgenabled
from pg_trigger
where tgrelid = 'public.sessions'::regclass
  and tgname in ('trg_consume_tournament_ticket', 'trg_prevent_tournament_mode_escalation');
-- 期待: 2行（tgenabled = 'O'）
