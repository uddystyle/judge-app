-- Migration 1034: 組織招待のRLSとトークン保管を強化
--
-- ⚠️ **DB先行。必ずこの migration を適用してからアプリをデプロイすること。**
-- アプリ側は token_hash / revoked_at を前提にしているため、順序を逆にすると
-- 招待の発行も受諾も全滅する（存在しない列を参照してクエリが失敗する）。
--
-- ⚠️ 全体を1トランザクションで流すこと（下の begin/commit）。途中で失敗したまま
-- 部分適用されると、平文 token が消えた状態で止まる可能性がある。
--
-- 目的:
-- - organization_members の自己 INSERT/UPDATE/DELETE による権限昇格を撤去する
-- - invitations の匿名 SELECT による token/email/role/org_id 列挙を撤去する
-- - 招待 token を SHA-256 hash 保管へ移行し、失効状態を持てるようにする

begin;

create extension if not exists pgcrypto;

-- 016/019 由来の自己管理ポリシーを明示撤去する。
-- 052 以降の admin scoped UPDATE / SELECT ポリシーは残す。
drop policy if exists "insert_own_membership" on public.organization_members;
drop policy if exists "update_own_membership" on public.organization_members;
drop policy if exists "delete_own_membership" on public.organization_members;

-- 招待 token の匿名列挙を閉じる。アプリは service role で token_hash を照合する。
drop policy if exists "Anyone can view valid invitation by token" on public.invitations;

alter table public.invitations
  add column if not exists token_hash text,
  add column if not exists revoked_at timestamptz,
  add column if not exists revoked_by uuid references auth.users(id) on delete set null;

comment on column public.invitations.token_hash is
  '招待URL token の SHA-256 hex digest。平文 token は保存しない。';
comment on column public.invitations.revoked_at is
  '招待を管理者が失効させた日時。NULL の場合のみ使用可能。';
comment on column public.invitations.revoked_by is
  '招待を失効させた管理者のユーザーID。';

-- 既存の平文 token を hash へ移行する。すでに token_hash がある行は保持する。
--
-- ⚠️ pgcrypto は Supabase では `extensions` スキーマに入る。search_path 頼みにせず修飾する
-- （修飾しないと、search_path に extensions を含まないロールで実行したときだけ失敗する）。
update public.invitations
set token_hash = encode(extensions.digest(token, 'sha256'), 'hex')
where token_hash is null
  and token is not null;

alter table public.invitations
  alter column token drop not null;

-- ⚠️ **平文の破棄は最後に行う。**
-- NOT NULL と UNIQUE を先に通すことで、「バックフィルが全行に行き渡っているか」
-- 「hash が重複していないか」をここで確定させる。
-- 順序を逆にすると、backfill が不完全なまま平文だけが消え、
-- 復元不可能な状態で移行が止まる（招待URLは二度と復元できない）。
alter table public.invitations
  alter column token_hash set not null;

create unique index if not exists invitations_token_hash_key
  on public.invitations(token_hash);

-- ここまで通れば全行の hash が揃っている。既存URLは提示された token を
-- アプリ側で hash 化して照合できるため、DB内の平文を消す。
update public.invitations
set token = null
where token is not null;

create index if not exists idx_invitations_active_by_org
  on public.invitations(organization_id, expires_at desc)
  where revoked_at is null;

-- 管理者の閲覧/削除ポリシーは removed_at を考慮した scoped 判定へ寄せる。
drop policy if exists "Organization admins can create invitations" on public.invitations;
create policy "Organization admins can create invitations"
  on public.invitations for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.organization_members
      where organization_members.organization_id = invitations.organization_id
        and organization_members.user_id = (select auth.uid())
        and organization_members.role = 'admin'
        and organization_members.removed_at is null
    )
  );

drop policy if exists "Organization admins can view invitations" on public.invitations;
create policy "Organization admins can view invitations"
  on public.invitations for select
  to authenticated
  using (
    exists (
      select 1
      from public.organization_members
      where organization_members.organization_id = invitations.organization_id
        and organization_members.user_id = (select auth.uid())
        and organization_members.role = 'admin'
        and organization_members.removed_at is null
    )
  );

drop policy if exists "Organization admins can delete invitations" on public.invitations;
create policy "Organization admins can delete invitations"
  on public.invitations for delete
  to authenticated
  using (
    exists (
      select 1
      from public.organization_members
      where organization_members.organization_id = invitations.organization_id
        and organization_members.user_id = (select auth.uid())
        and organization_members.role = 'admin'
        and organization_members.removed_at is null
    )
  );

commit;
