-- ============================================================================
-- Verify 1029: subscriptions の CHECK が Stripe の全ステータスを受け付けるか
-- ============================================================================
-- prod / dev の**両方**で実行し、3クエリすべてが期待どおりであることを確認する。
-- 読み取りのみ（(C) は一時テーブルで検証し、本番テーブルには一切書き込まない）。
-- ============================================================================

-- (A) 制約定義の確認
--     期待: status に incomplete / incomplete_expired / trialing / active /
--           past_due / canceled / unpaid / paused の8値がすべて現れる。
--           plan_type = free/basic/standard/premium（pro を含まないこと）。
--           billing_interval = month/year。
select conname, pg_get_constraintdef(oid) as def
from pg_constraint
where conrelid = 'public.subscriptions'::regclass
	and contype = 'c'
order by conname;

-- (B) 矛盾の解消確認
--     期待: 部分一意インデックス subscriptions_organization_active_unique が参照する
--           'active' / 'trialing' が、どちらも (A) の status CHECK に含まれていること。
--           （適用前の prod では trialing が CHECK に無く、条件が成立しない状態だった）
select indexname, indexdef
from pg_indexes
where schemaname = 'public'
	and tablename = 'subscriptions'
	and indexname = 'subscriptions_organization_active_unique';

-- (C) 実際に8ステータスすべてが通ることの確認
--     subscriptions と同じ CHECK を持つ一時テーブルを作り、8値の投入を試す。
--     期待: inserted = 8。本番テーブルには触れない。
do $$
declare
	v_def text;
	v_count int;
begin
	select pg_get_constraintdef(oid) into v_def
	from pg_constraint
	where conrelid = 'public.subscriptions'::regclass and conname = 'subscriptions_status_check';

	execute 'create temp table _verify_1029 (status text) on commit drop';
	execute format('alter table _verify_1029 add constraint _verify_status %s', v_def);

	insert into _verify_1029(status) values
		('incomplete'), ('incomplete_expired'), ('trialing'), ('active'),
		('past_due'), ('canceled'), ('unpaid'), ('paused');

	select count(*) into v_count from _verify_1029;
	raise notice 'VERIFY 1029: inserted=% (expected 8)', v_count;

	if v_count <> 8 then
		raise exception 'VERIFY 1029 FAILED: expected 8 statuses to be accepted, got %', v_count;
	end if;
end $$;

-- (D) 既存データが新CHECKに適合しているか（0行なら問題なし）
select status, count(*)
from subscriptions
where status not in (
	'incomplete', 'incomplete_expired', 'trialing', 'active',
	'past_due', 'canceled', 'unpaid', 'paused'
)
group by status;
