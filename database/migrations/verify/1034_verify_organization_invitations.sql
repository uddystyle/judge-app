-- 1034 verification: 招待RLSとtoken hash移行の確認

select
  'dangerous organization_members self policies removed' as check_name,
  count(*) as violation_count
from pg_policies
where schemaname = 'public'
  and tablename = 'organization_members'
  and policyname in ('insert_own_membership', 'update_own_membership', 'delete_own_membership');

select
  'public invitation token select removed' as check_name,
  count(*) as violation_count
from pg_policies
where schemaname = 'public'
  and tablename = 'invitations'
  and policyname = 'Anyone can view valid invitation by token';

select
  'invitation plaintext tokens removed' as check_name,
  count(*) as violation_count
from public.invitations
where token is not null;

select
  'invitation token hashes populated' as check_name,
  count(*) as violation_count
from public.invitations
where token_hash is null
   or token_hash !~ '^[0-9a-f]{64}$';

select
  'invitation revoke columns present' as check_name,
  count(*) as present_count
from information_schema.columns
where table_schema = 'public'
  and table_name = 'invitations'
  and column_name in ('token_hash', 'revoked_at', 'revoked_by');
