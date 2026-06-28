-- ============================================================================
-- READ-ONLY RLS audit: 過剰な (USING true / WITH CHECK true) ポリシー残存チェック
-- ============================================================================
-- 目的: 過去のスキーマ/RLS ドリフト（手動適用）で、機微テーブルに「誰でも読める/書ける」
--       (=true) ポリシーが残っていないかを本番(prod)で最終確認する。
-- 実行: Supabase SQL Editor（prod、できれば dev も）で全クエリを実行し、結果を貼る。
-- 変更なし（SELECT のみ）。結果はこのファイルに貼らない。
-- ============================================================================

-- 1) 過剰ポリシー（USING true もしくは WITH CHECK true）= 最重要チェック。
--    期待値: 0 行（機微テーブルに over-broad ポリシーが無いこと）。
select schemaname, tablename, policyname, cmd, roles::text as roles, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename in (
    'results', 'session_participants', 'sessions', 'scoring_prompts',
    'custom_events', 'training_scores', 'participants', 'profiles',
    'organizations', 'organization_members'
  )
  and (
    lower(btrim(coalesce(qual, ''))) = 'true'
    or lower(btrim(coalesce(with_check, ''))) = 'true'
  )
order by tablename, cmd, policyname;

-- 2) RLS 有効状態。期待値: 全テーブル rls_enabled = true（false だとポリシー無視＝全開）。
select c.relname as table_name, c.relrowsecurity as rls_enabled, c.relforcerowsecurity as rls_forced
from pg_class c
where c.relnamespace = 'public'::regnamespace
  and c.relkind = 'r'
  and c.relname in (
    'results', 'session_participants', 'sessions', 'scoring_prompts',
    'custom_events', 'training_scores', 'participants', 'profiles',
    'organizations', 'organization_members'
  )
order by c.relname;

-- 3) results / session_participants の全ポリシー（owner/membership スコープを目視確認）。
--    results 期待: anon_results_{insert,update}_by_owner, auth_results_{insert,update}_by_owner,
--      anon_results_select_scoped_by_jwt, "Authenticated users can view results in their sessions",
--      chief_judge_can_delete_results（USING true は無し）。
--    session_participants 期待: SELECT は is_session_member/own のみ（USING true は無し）。
select tablename, policyname, cmd, roles::text as roles,
       left(coalesce(qual, ''), 120) as using_expr,
       left(coalesce(with_check, ''), 120) as check_expr
from pg_policies
where schemaname = 'public'
  and tablename in ('results', 'session_participants')
order by tablename, cmd, policyname;
