-- ============================================================================
-- Verify 1030/1031: stripe_events（Webhook 冪等化）の検証
-- ============================================================================
-- prod / dev の**両方**で実行する。読み取り＋一時テーブルのみで、本番テーブルには書き込まない。
-- ============================================================================

-- (A) テーブルが service role 専用になっているか
--     期待: rls_enabled = true / policy_count = 0
--     （ポリシーが1本でもあると、アプリのユーザークライアントから課金イベントの
--       処理履歴が読めてしまう）
select
	(select relrowsecurity from pg_class where oid = 'public.stripe_events'::regclass) as rls_enabled,
	(select count(*) from pg_policies where schemaname = 'public' and tablename = 'stripe_events')
		as policy_count;

-- (B) 1031 の列と制約
--     期待: status / claimed_at / failure_reason が存在し、
--           status の CHECK が processing / completed / dropped の3値。
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'stripe_events'
order by ordinal_position;

select conname, pg_get_constraintdef(oid) as def
from pg_constraint
where conrelid = 'public.stripe_events'::regclass and contype = 'c';

-- (C) 状態遷移が制約を通ることの確認（一時テーブル。本番テーブルには触れない）
--     期待: accepted = 3（processing / completed / dropped がすべて通る）
--           かつ不正値が拒否される
do $$
declare
	v_def text;
	v_count int;
	v_rejected boolean := false;
begin
	select pg_get_constraintdef(oid) into v_def
	from pg_constraint
	where conrelid = 'public.stripe_events'::regclass and conname = 'stripe_events_status_check';

	create temp table _verify_1031 (status text) on commit drop;
	execute format('alter table _verify_1031 add constraint _v %s', v_def);

	insert into _verify_1031(status) values ('processing'), ('completed'), ('dropped');
	select count(*) into v_count from _verify_1031;

	begin
		insert into _verify_1031(status) values ('bogus');
	exception when check_violation then
		v_rejected := true;
	end;

	raise notice 'VERIFY 1031: accepted=% (expected 3), rejected_bogus=% (expected t)', v_count, v_rejected;
	if v_count <> 3 or not v_rejected then
		raise exception 'VERIFY 1031 FAILED: accepted=%, rejected_bogus=%', v_count, v_rejected;
	end if;
end $$;

-- (D) 運用監視: 破棄されたイベント（dead-letter）
--     0行が正常。行があれば event_id から stripe.events.retrieve() で内容を再取得し、
--     再処理の要否を判断する。
select event_id, event_type, failure_reason, processed_at
from stripe_events
where status = 'dropped'
order by processed_at desc
limit 50;

-- (E) 運用監視: リース切れのまま残った processing
--     通常は 0行。行が残る場合、そのイベントは Stripe の再送で自動的に再取得されるが、
--     Stripe の再送期限（3日）を過ぎているなら手動で再送する必要がある。
select event_id, event_type, claimed_at, now() - claimed_at as stale_for
from stripe_events
where status = 'processing' and claimed_at < now() - interval '1 minute'
order by claimed_at;

-- (F) 掃除の目安（保持期間の運用は別途決める。ここでは件数の把握のみ）
select status, count(*), min(processed_at) as oldest
from stripe_events
group by status;
