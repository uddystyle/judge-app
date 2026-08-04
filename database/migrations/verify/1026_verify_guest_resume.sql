-- ============================================================================
-- Verify for Migration 1026: guest_resume_tokens
-- ============================================================================
-- 1026 適用後に dev / prod の SQL Editor で流し、全チェックが ✅ になることを確認する。
-- 読み取り専用。何度でも実行してよい。
-- ============================================================================

-- (1) テーブルが存在し RLS が有効であること
select
  case when count(*) = 1 then '✅ PASS' else '❌ FAIL' end as check_1_table_with_rls,
  count(*) as found
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'guest_resume_tokens' and c.relrowsecurity;

-- (2) ポリシーが 0 件であること（service role 専用＝同席者から到達不能）
select
  case when count(*) = 0 then '✅ PASS' else '❌ FAIL' end as check_2_no_policies,
  count(*) as policies
from pg_policies
where schemaname = 'public' and tablename = 'guest_resume_tokens';

-- (3) token 未発行のゲスト参加行が 0 件であること
select
  case when count(*) = 0 then '✅ PASS' else '❌ FAIL' end as check_3_all_guests_have_token,
  count(*) as missing
from public.session_participants sp
where sp.is_guest = true
  and not exists (select 1 from public.guest_resume_tokens t where t.participant_id = sp.id);

-- (4) token の重複が無いこと → 0 行が期待値
select token, count(*) as rows
from public.guest_resume_tokens
group by token
having count(*) > 1;

-- (5) 参考: 発行数とゲスト行数
select
  (select count(*) from public.guest_resume_tokens)                            as tokens,
  (select count(*) from public.session_participants where is_guest = true)     as guest_rows;
