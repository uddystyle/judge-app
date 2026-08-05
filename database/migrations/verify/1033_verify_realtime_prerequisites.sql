-- ============================================================================
-- Verify 1033: Realtime の DB 前提条件
-- ============================================================================
-- prod / dev の**両方**で実行する。読み取りのみ。
--
-- ⚠️ scripts/check-realtime-setup.sql は SELECT ポリシーの判定が COUNT(*) > 0 で、
--    3テーブルのうち1つにあるだけで合格になっていた。ここでは**テーブル単位**で見る。
-- ============================================================================

-- (A) publication と REPLICA IDENTITY
--     期待: 3行すべて published=true / replica_identity='f'
select c.relname as tbl,
       (c.relreplident = 'f') as replica_identity_full,
       exists (
         select 1 from pg_publication_tables t
         where t.pubname = 'supabase_realtime'
           and t.schemaname = 'public'
           and t.tablename = c.relname
       ) as published
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('training_scores', 'results', 'sessions')
order by c.relname;

-- (B) 総合判定（テーブル単位で厳密に見る）
do $$
declare
	missing text;
begin
	select string_agg(t.name, ', ')
	into missing
	from (values ('training_scores'), ('results'), ('sessions')) as t(name)
	where to_regclass('public.' || t.name) is null
	   or (select relreplident from pg_class where oid = ('public.' || t.name)::regclass) <> 'f'
	   or not exists (
	        select 1 from pg_publication_tables p
	        where p.pubname = 'supabase_realtime'
	          and p.schemaname = 'public'
	          and p.tablename = t.name
	      );

	if missing is null then
		raise notice 'VERIFY 1033: OK — 3テーブルとも publication 収録済み・REPLICA IDENTITY FULL';
	else
		raise exception 'VERIFY 1033 FAILED: 前提条件を満たさないテーブル: %', missing;
	end if;
end $$;

-- (C) SELECT ポリシーの有無を**テーブルごとに**確認
--     Realtime は RLS を通すため、SELECT ポリシーが無いテーブルはイベントが届かない。
--     期待: 3行とも has_select_policy = true
select t.name as tbl,
       exists (
         select 1 from pg_policies p
         where p.schemaname = 'public' and p.tablename = t.name and p.cmd = 'SELECT'
       ) as has_select_policy
from (values ('training_scores'), ('results'), ('sessions')) as t(name)
order by t.name;
