-- ============================================================================
-- Verify 1035: subscriptions の組織管理者向け SELECT ポリシー
-- ============================================================================
-- prod / dev の**両方**で実行する。読み取りのみ（(C) はロールバックする）。
-- ============================================================================

-- (A) ポリシーの構成
--     期待: select_policies = 2（本人 + 組織管理者）
--           write_policies  = 0（書き込みは service role 専用のまま）
select
	count(*) filter (where cmd = 'SELECT') as select_policies,
	count(*) filter (where cmd in ('INSERT', 'UPDATE', 'DELETE')) as write_policies
from pg_policies
where schemaname = 'public' and tablename = 'subscriptions';

-- (B) 追加したポリシーの定義
--     期待: 1 行。qual に is_organization_admin(organization_id) を含む
select policyname, cmd, roles::text, qual
from pg_policies
where schemaname = 'public'
  and tablename = 'subscriptions'
  and policyname = 'authed_subscriptions_select_by_org_admin';

-- (C) 実際の可視性（本番データを変更しない。最後に rollback する）
--     期待: contract_owner / org_admin ともに visible >= 1
--           non_member は visible = 0
--     ※ 有料契約が 1 件も無い環境では 3 行とも 0 になる（その場合は判定不能）
begin;

create temp table if not exists v1035(who text, visible bigint) on commit drop;

do $$
declare
	target_org uuid;
	owner_id uuid;
	admin_id uuid;
	outsider_id uuid;
	n bigint;
begin
	select s.organization_id, s.user_id into target_org, owner_id
	from subscriptions s
	where s.organization_id is not null
	limit 1;

	if target_org is null then
		insert into v1035 values ('対象の契約が無いため判定不能', 0);
		return;
	end if;

	select m.user_id into admin_id
	from organization_members m
	where m.organization_id = target_org
	  and m.role = 'admin'
	  and m.removed_at is null
	  and m.user_id <> owner_id
	limit 1;

	select u.id into outsider_id
	from auth.users u
	where not exists (
		select 1 from organization_members m
		where m.organization_id = target_org and m.user_id = u.id
	)
	limit 1;

	perform set_config('request.jwt.claims',
		json_build_object('sub', owner_id, 'role', 'authenticated')::text, true);
	set local role authenticated;
	select count(*) into n from subscriptions where organization_id = target_org;
	reset role;
	insert into v1035 values ('contract_owner', n);

	if admin_id is not null then
		perform set_config('request.jwt.claims',
			json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
		set local role authenticated;
		select count(*) into n from subscriptions where organization_id = target_org;
		reset role;
		insert into v1035 values ('org_admin(契約者以外)', n);
	else
		insert into v1035 values ('org_admin(契約者以外・不在)', -1);
	end if;

	if outsider_id is not null then
		perform set_config('request.jwt.claims',
			json_build_object('sub', outsider_id, 'role', 'authenticated')::text, true);
		set local role authenticated;
		select count(*) into n from subscriptions where organization_id = target_org;
		reset role;
		insert into v1035 values ('non_member', n);
	end if;
end $$;

select * from v1035;

rollback;
