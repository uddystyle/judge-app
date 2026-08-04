-- ============================================================================
-- Verify for Migration 1025: ゲスト身元の auth.uid() 束縛
-- ============================================================================
-- 1025 適用後に dev / prod の SQL Editor で流し、全チェックが ✅ になることを確認する。
-- 読み取り専用。何度でも実行してよい。
-- ============================================================================

-- (1) user_metadata を認可に使うポリシーが全廃されていること（今回の本丸）
select
  case when count(*) = 0 then '✅ PASS' else '❌ FAIL' end as check_1_no_user_metadata_policies,
  count(*) as remaining
from pg_policies
where schemaname = 'public'
  and (coalesce(qual, '') || coalesce(with_check, '')) ilike '%user_metadata%';

-- 残っている場合はここに出る（0行が期待値）
select tablename, policyname, cmd, roles::text
from pg_policies
where schemaname = 'public'
  and (coalesce(qual, '') || coalesce(with_check, '')) ilike '%user_metadata%'
order by tablename, policyname;

-- (2) 発火しない anon_*_by_jwt 群が撤去されていること
select
  case when count(*) = 0 then '✅ PASS' else '❌ FAIL' end as check_2_no_anon_by_jwt_policies,
  count(*) as remaining
from pg_policies
where schemaname = 'public'
  and (policyname like 'anon\_%\_by\_jwt' or policyname like 'anon\_%\_by\_owner'
       or policyname like 'anon\_%\_scoped\_by\_jwt'
       or policyname = 'Anonymous users can view training events');

-- (3) ゲスト owner 書込みポリシーが 5 本そろっていること
select
  case when count(*) = 5 then '✅ PASS' else '❌ FAIL' end as check_3_guest_owner_policies,
  count(*) as found
from pg_policies
where schemaname = 'public' and policyname like 'guest\_%\_by\_owner';

select tablename, policyname, cmd, roles::text
from pg_policies
where schemaname = 'public' and policyname like 'guest\_%\_by\_owner'
order by tablename, policyname;

-- (4) ヘルパ関数が SECURITY DEFINER かつ search_path 固定で存在すること
select
  case when count(*) = 1 then '✅ PASS' else '❌ FAIL' end as check_4_helper_exists,
  count(*) as found
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'current_guest_identifier'
  and p.prosecdef
  and array_to_string(coalesce(p.proconfig, '{}'), ',') ilike '%search_path%';

-- (5) ゲスト参加行の user_id 束縛率
-- 匿名認証の導入前に作られた古い行は突合できず user_id NULL のまま残る（想定内）。
-- 「未束縛」が最近のセッションを含む場合はアプリ側の束縛が働いていない疑い。
select
  count(*)                                         as guest_rows_total,
  count(user_id)                                   as bound,
  count(*) - count(user_id)                        as unbound,
  max(joined_at) filter (where user_id is null)    as newest_unbound_joined_at
from public.session_participants
where is_guest = true;

-- (6) 束縛の一意性（同一セッション内で uid が重複していないこと）→ 0 行が期待値
select session_id, user_id, count(*) as rows
from public.session_participants
where user_id is not null
group by session_id, user_id
having count(*) > 1;
