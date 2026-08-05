-- Rollback 1034: 最小限の緊急復旧用
--
-- 注意: 1034 適用後に平文 token は削除済みのため、旧URLを復元することはできない。
-- 必要なら新しい招待を発行する。

drop index if exists public.invitations_token_hash_key;
drop index if exists public.idx_invitations_active_by_org;

alter table public.invitations
  alter column token_hash drop not null;

-- 匿名 SELECT ポリシーを戻すことはセキュリティ上推奨しないため、この rollback では戻さない。
-- 自己 INSERT/UPDATE/DELETE ポリシーも権限昇格穴のため戻さない。
