-- ============================================================================
-- Migration 1023: contact_submissions.category に tournament_quote を追加
-- ============================================================================
-- WHY: 大会モードのスポット販売化に伴い、問い合わせフォームに
--      「大会利用のお見積り」区分（tournament_quote）を追加する。
--      023 で category に CHECK 制約があるため、制約の張り替えが必要。
-- WHAT: category の CHECK 制約（名称不定のため定義文で特定）を drop し、
--       tournament_quote を含む名前付き制約で再作成。
-- 冪等（再実行時は自制約を張り替えるだけ）。DEV 先行 → prod。
-- 問題時は rollbacks/1023_rollback.sql。
-- 注意: 023 自体が APPLIED.md 上「⚠️要確認」のため、適用前に下の (0) で
--       テーブルと制約の実在を確認すること。
-- ============================================================================

-- (0) 事前確認（実行してから本体を流す）
-- select conname, pg_get_constraintdef(oid)
-- from pg_constraint
-- where conrelid = 'public.contact_submissions'::regclass and contype = 'c';

begin;

do $$
declare
  v_conname text;
begin
  -- category の値リストを縛っている CHECK 制約を定義文から特定して撤去
  -- （valid_email / status の CHECK には触れない）
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
    check (category in ('general', 'technical', 'billing', 'feature', 'tournament_quote', 'other'));
end $$;

commit;

-- 検証
select conname, pg_get_constraintdef(oid) as def
from pg_constraint
where conrelid = 'public.contact_submissions'::regclass
  and contype = 'c'
order by conname;
-- 期待: contact_submissions_category_check に tournament_quote が含まれる
