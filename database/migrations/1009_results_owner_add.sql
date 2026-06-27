-- ============================================================================
-- Migration 1009 (#7 phase 1): add owner columns to results (ADDITIVE / 旧アプリ互換)
-- ============================================================================
-- results を judge_name だけでなく owner（authed=judge_id / guest=guest_identifier）で
-- 識別できるようにする第1段階。**この段階は旧アプリと互換**（旧 name-unique・旧RLSを維持、
-- 新列は nullable）。本番に先行適用しても旧アプリは壊れない。
-- 第2段階 1010 で owner 強制（旧 name-unique 撤去・RLS を owner 基準へ）。
--
-- 適用順（無停止）: prod に 1009 → 新アプリをデプロイ → prod に 1010。
-- 冪等。DEV 先行。
-- ============================================================================

-- 1) 列追加（nullable）
alter table public.results add column if not exists judge_id uuid;
alter table public.results add column if not exists guest_identifier text;

-- 2) judge_id の FK（冪等）
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.results'::regclass and conname = 'results_judge_id_fkey'
  ) then
    alter table public.results
      add constraint results_judge_id_fkey
      foreign key (judge_id) references auth.users(id) on delete cascade;
  end if;
end $$;

-- 3) 軽い CHECK（両方同時セットのみ禁止。legacy の両 null は許容）冪等
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.results'::regclass and conname = 'results_owner_at_most_one'
  ) then
    alter table public.results
      add constraint results_owner_at_most_one
      check (not (judge_id is not null and guest_identifier is not null));
  end if;
end $$;

-- 4) best-effort backfill（in-flight セッションの二重行を防ぐ）。
--    session 内で judge_name が**一意に**メンバー/ゲストへ解決できる行のみ埋める。曖昧/不能は null のまま。
--    authed を先に、その後まだ null の行をゲストで。
update public.results r
set judge_id = p.id
from public.profiles p
join public.session_participants sp
  on sp.user_id = p.id and sp.is_guest = false
where r.judge_id is null
  and r.guest_identifier is null
  and r.session_id = sp.session_id
  and r.judge_name = p.full_name
  and (
    select count(*) from public.profiles p2
    join public.session_participants sp2 on sp2.user_id = p2.id and sp2.is_guest = false
    where sp2.session_id = r.session_id and p2.full_name = r.judge_name
  ) = 1;

update public.results r
set guest_identifier = sp.guest_identifier
from public.session_participants sp
where r.judge_id is null
  and r.guest_identifier is null
  and sp.is_guest = true
  and sp.guest_name is not null
  and r.session_id = sp.session_id
  and r.judge_name = sp.guest_name
  and (
    select count(*) from public.session_participants sp2
    where sp2.session_id = r.session_id and sp2.is_guest = true and sp2.guest_name = r.judge_name
  ) = 1;

-- 5) owner 基準の部分一意索引（owner がある行のみ一意。legacy null-owner 行は対象外）
create unique index if not exists results_unique_owner_auth
  on public.results (session_id, bib, discipline, level, event_name, judge_id)
  where judge_id is not null;

create unique index if not exists results_unique_owner_guest
  on public.results (session_id, bib, discipline, level, event_name, guest_identifier)
  where guest_identifier is not null;

-- 旧 name-unique（results_unique_score_entry / results_unique_score / unique_result_per_judge）と
-- 旧 RLS は **この段階では撤去しない**（後方互換）。1010 で撤去する。

-- 検証
do $$
declare
  with_owner int;
  total int;
begin
  select count(*) into total from public.results;
  select count(*) into with_owner from public.results where judge_id is not null or guest_identifier is not null;
  raise notice '1009: results backfilled owner % / % rows', with_owner, total;
end $$;
