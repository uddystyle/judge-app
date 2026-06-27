-- ============================================================================
-- Base schema reference: public.sessions
-- ============================================================================
-- 本番（prod）の実態を introspection（information_schema.columns / pg_constraint /
-- pg_indexes）から復元した参照スキーマ（2026-06-27 取得）。
-- 目的: 新規DB再構築のベースライン＋ドリフト基準のドキュメント。
-- 冪等／既存DBには no-op（CREATE TABLE/INDEX IF NOT EXISTS, FK は存在チェック付き）。
-- ※ FK は scoring_prompts / organizations / auth.users が先に存在している必要がある
--   （新規DBで使う場合は依存テーブルを先に作成すること）。
--
-- ⚠️ ドリフト注記（重要）:
--   prod の sessions には `failed_join_attempts` / `is_locked` 列が **存在しない**。
--   これらは migration `001_add_session_security.sql` が追加するが、**prod に未適用の疑い**。
--   一方 src/routes/session/join/+page.server.ts はこの2列を select / update している
--   （参加コードのロック機能 L74,92,106,115-116,132）。
--   → 参加コード join は prod で 500 になっている可能性（招待リンク join はこの列を見ないので動く）。
--   修正: **`001_add_session_security.sql` を dev/prod に当てる**（冪等・追加のみ・アプリ変更不要）。
--   本ベーススキーマは「base（001 適用前）」を表すため、この2列は含めない（001 が追加する）。
-- ============================================================================

create table if not exists public.sessions (
	id bigserial primary key,
	name text not null,
	created_by uuid,
	chief_judge_id uuid,
	join_code text not null,
	is_active boolean not null default true,
	is_accepting_participants boolean not null default true,
	status text not null default 'active',
	mode text default 'certification',
	is_tournament_mode boolean default false,
	score_calculation text default 'average',
	exclude_extremes boolean default false,
	organization_id uuid not null,
	session_date date default now(),
	created_at timestamptz default now(),
	updated_at timestamptz,
	required_judges bigint default 1,
	is_multi_judge boolean,
	active_prompt_id bigint,
	invite_token text,
	invite_token_created_at timestamptz default now(),
	max_score_diff integer,
	deleted_at timestamptz,
	deleted_by uuid,
	constraint sessions_join_code_key unique (join_code),
	constraint sessions_invite_token_key unique (invite_token),
	constraint sessions_max_score_diff_check
		check (max_score_diff is null or (max_score_diff >= 1 and max_score_diff <= 10))
);

-- FK（存在チェック付き・冪等）。参照先テーブルが先に必要。
do $$
begin
	if not exists (select 1 from pg_constraint where conrelid = 'public.sessions'::regclass and conname = 'sessions_active_prompt_id_fkey') then
		alter table public.sessions add constraint sessions_active_prompt_id_fkey
			foreign key (active_prompt_id) references public.scoring_prompts(id) on delete set null;
	end if;
	if not exists (select 1 from pg_constraint where conrelid = 'public.sessions'::regclass and conname = 'sessions_chief_judge_id_fkey') then
		alter table public.sessions add constraint sessions_chief_judge_id_fkey
			foreign key (chief_judge_id) references auth.users(id) on delete set null;
	end if;
	if not exists (select 1 from pg_constraint where conrelid = 'public.sessions'::regclass and conname = 'sessions_created_by_fkey') then
		alter table public.sessions add constraint sessions_created_by_fkey
			foreign key (created_by) references auth.users(id) on delete set null;
	end if;
	if not exists (select 1 from pg_constraint where conrelid = 'public.sessions'::regclass and conname = 'sessions_deleted_by_fkey') then
		alter table public.sessions add constraint sessions_deleted_by_fkey
			foreign key (deleted_by) references auth.users(id);
	end if;
	if not exists (select 1 from pg_constraint where conrelid = 'public.sessions'::regclass and conname = 'sessions_organization_id_fkey') then
		alter table public.sessions add constraint sessions_organization_id_fkey
			foreign key (organization_id) references public.organizations(id);
	end if;
end $$;

-- 索引（unique 索引は上の制約が生成。ここでは非ユニーク索引のみ）
create index if not exists idx_sessions_active on public.sessions using btree (is_active) where (is_active = true);
create index if not exists idx_sessions_deleted_at on public.sessions using btree (deleted_at) where (deleted_at is null);
create index if not exists idx_sessions_invite_token on public.sessions using btree (invite_token);
create index if not exists idx_sessions_join_code on public.sessions using btree (join_code);
create index if not exists idx_sessions_mode on public.sessions using btree (mode);
create index if not exists idx_sessions_organization on public.sessions using btree (organization_id);
create index if not exists idx_sessions_organization_created on public.sessions using btree (organization_id, created_at desc);
