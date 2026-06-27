-- ============================================================================
-- Migration 1011 (#8): sessions の chief_judge_id / created_by に
--                      ON DELETE SET NULL の FK を整備（auth.users へ統一）
-- ============================================================================
-- WHY: sessions.chief_judge_id は FK 無し → ユーザー削除でダングリング（採点制御不能）。
--      created_by は prod=auth.users CASCADE（退会で作成セッション一式が連鎖削除）/
--      dev=profiles NO ACTION（ダングリング）で不一致。
-- WHAT: 両カラムを `auth.users(id) ON DELETE SET NULL` に統一。退会してもセッション・
--       participants・results・得点は残し、chief_judge_id / created_by だけ NULL になる。
--       （アプリは NULL を許容：isChiefJudge=false、appointChief は org メンバー RLS で再設定可）
-- DBのみ・アプリ無変更・デプロイ順序の制約なし。冪等。DEV 先行 → prod。問題時 1011_rollback.sql。
-- ============================================================================

begin;

-- 1) ダングリング参照を NULL 化（FK 追加の前提。auth.users に存在しない uuid を掃除）
do $$
declare n int;
begin
  update public.sessions set chief_judge_id = null
  where chief_judge_id is not null
    and chief_judge_id not in (select id from auth.users);
  get diagnostics n = row_count;
  raise notice 'nulled dangling chief_judge_id rows: %', n;
end $$;

do $$
declare n int;
begin
  update public.sessions set created_by = null
  where created_by is not null
    and created_by not in (select id from auth.users);
  get diagnostics n = row_count;
  raise notice 'nulled dangling created_by rows: %', n;
end $$;

-- 2) chief_judge_id FK（SET NULL）
alter table public.sessions drop constraint if exists sessions_chief_judge_id_fkey;
alter table public.sessions
  add constraint sessions_chief_judge_id_fkey
  foreign key (chief_judge_id) references auth.users(id) on delete set null;

-- 3) created_by FK（SET NULL・auth.users へ統一）— prod の CASCADE / dev の profiles NO ACTION を置換
alter table public.sessions drop constraint if exists sessions_created_by_fkey;
alter table public.sessions
  add constraint sessions_created_by_fkey
  foreign key (created_by) references auth.users(id) on delete set null;

commit;

-- 4) 検証
select
  conname,
  pg_get_constraintdef(oid) as definition,
  case confdeltype
    when 'a' then 'NO ACTION'
    when 'r' then 'RESTRICT'
    when 'c' then 'CASCADE'
    when 'n' then 'SET NULL'
    when 'd' then 'SET DEFAULT'
  end as on_delete
from pg_constraint
where conrelid = 'public.sessions'::regclass
  and contype = 'f'
  and conname in ('sessions_chief_judge_id_fkey', 'sessions_created_by_fkey')
order by conname;
