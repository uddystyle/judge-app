-- ============================================================================
-- Rollback for Migration 1023: category CHECK 制約を 023 相当に戻す
-- ============================================================================
-- 緊急時のみ。tournament_quote の行が既に存在する場合、この制約追加は
-- 失敗する（先に該当行の category を 'billing' 等へ UPDATE すること）。冪等。
-- ============================================================================

begin;

do $$
declare
  v_conname text;
begin
  for v_conname in
    select conname
    from pg_constraint
    where conrelid = 'public.contact_submissions'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%category%'
  loop
    execute format('alter table public.contact_submissions drop constraint %I', v_conname);
  end loop;

  alter table public.contact_submissions
    add constraint contact_submissions_category_check
    check (category in ('general', 'technical', 'billing', 'feature', 'other'));
end $$;

commit;

select conname, pg_get_constraintdef(oid) as def
from pg_constraint
where conrelid = 'public.contact_submissions'::regclass
  and contype = 'c'
order by conname;
