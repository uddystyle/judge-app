-- ============================================================================
-- Migration 1024: score_mutations（オフライン採点同期の mutation log）を追加
-- ============================================================================
-- WHY: ネットワーク耐性戦略（docs/architecture/network-resilience-strategy.md）
--      Phase 2 の冪等な同期 API のため。クライアントは採点を端末（IndexedDB）に
--      保存し、復帰後に /api/sync/scores へ client_mutation_id 付きで送信する。
--      同じ mutation のリトライ・二重送信を1回だけ処理するための処理済み記録と、
--      受理/拒否の監査ログを兼ねる。
-- WHAT: score_mutations を新設。client_mutation_id unique が冪等性の要。
--       RLS: 有効化のみでポリシーは作らない（読み書きとも service role 専用。
--       クライアントには同期 API の応答で結果を返すため直接参照は不要）。
-- 冪等。DEV 先行 → prod。問題時は rollbacks/1024_rollback.sql。
-- ============================================================================

begin;

create table if not exists public.score_mutations (
  id uuid primary key default gen_random_uuid(),
  client_mutation_id text not null,
  session_id bigint not null,
  mode_type text not null,
  event_id bigint,                 -- tournament/training のみ
  bib_number integer not null,
  score integer not null,
  judge_id uuid,                   -- 認証ユーザーの場合
  guest_identifier text,           -- ゲストの場合
  payload jsonb,                   -- 受信した mutation の原文（監査用）
  status text not null,            -- 'accepted' | 'rejected'
  rejection_reason text,
  created_at_local timestamptz,    -- 端末側の作成時刻（参考値。判定には使わない）
  created_at_server timestamptz not null default now(),
  constraint score_mutations_status_check
    check (status in ('accepted', 'rejected')),
  constraint score_mutations_mode_check
    check (mode_type in ('certification', 'tournament', 'training'))
);

-- 冪等性の要: 同一 client_mutation_id は1行のみ
create unique index if not exists score_mutations_client_mutation_id_key
  on public.score_mutations (client_mutation_id);

create index if not exists idx_score_mutations_session
  on public.score_mutations (session_id);

-- FK（pg_constraint 存在チェックで冪等）。sessions は物理削除があるため cascade で
-- mutation log も落とす（採点実体が消えるならログだけ残す意味が薄い。請求監査
-- ではないので tournament_tickets とは方針が異なる）
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.score_mutations'::regclass
      and conname = 'score_mutations_session_id_fkey'
  ) then
    alter table public.score_mutations
      add constraint score_mutations_session_id_fkey
      foreign key (session_id) references public.sessions(id) on delete cascade;
  end if;
end $$;

-- RLS: 有効化のみ（ポリシー無し = anon/authenticated は読み書き不可、service role 専用）
alter table public.score_mutations enable row level security;

commit;

-- 検証
select policyname from pg_policies
where schemaname = 'public' and tablename = 'score_mutations';
-- 期待: 0行（ポリシー無し）

select indexname from pg_indexes
where schemaname = 'public' and tablename = 'score_mutations'
order by indexname;
-- 期待: pkey / client_mutation_id_key / idx_score_mutations_session
