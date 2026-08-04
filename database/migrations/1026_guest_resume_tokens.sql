-- ============================================================================
-- Migration 1026: guest_resume_tokens（ゲスト復帰用の資格情報を分離）
-- ============================================================================
-- WHY: 1025 でゲストの身元を auth.uid() 束縛にした後も、`/session/[id]?guest=<識別子>`
--      の再採用フローが残っていた。この経路は呼び出し元の身元を問わず、service role で
--      参加行を引いて新しい匿名 uid を再束縛する。「guest_identifier の所持＝本人証明」
--      というベアラ前提だが、**その値は同一セッションの参加者全員に開示されている**
--      （session_participants の SELECT は同席者に開かれ、/api/score-status の応答や
--      ScoresTable の hidden input にも載る。dev で実地確認済み）。
--      結果、同席者が他検定員の identity を乗っ取れ、さらに 1025 の uid 束縛により
--      本来の持ち主が uid 不一致でロックアウトされる。
-- WHAT: 「採点行の owner を表す識別子（同席者に見えてよい）」と「identity を復帰させる
--      資格情報（本人の端末だけが持つ）」を分離する。guest_identifier は owner 列として
--      据え置き、復帰は本テーブルの token で行う。
--      RLS は有効化のみでポリシーを作らない（＝service role 専用。同席者は PostgREST
--      から一切読めない）。1024_add_score_mutations.sql と同じパターン。
--      ※ session_participants に列を足す案は、同席者が select=* で読めてしまい、
--        列単位 GRANT で隠すと sessionAuth の .select('*') が権限エラーで壊れるため不採用。
-- 適用順: **DB 先行**。本テーブルはアプリが読む前に存在する必要があり、旧アプリは
--        一切触らないため DB 先行が安全側。
-- 冪等。DEV 先行 → prod。問題時は rollbacks/1026_rollback.sql。
-- ============================================================================

begin;

create table if not exists public.guest_resume_tokens (
  participant_id uuid primary key
    references public.session_participants(id) on delete cascade,
  token          text not null unique,
  created_at     timestamptz not null default now()
);

comment on table public.guest_resume_tokens is
  'ゲストが identity を復帰させるための資格情報。guest_identifier（同席者に見える owner 列）とは別物で、本人の端末だけが持つ。service role 専用（RLS 有効・ポリシー無し）。';

alter table public.guest_resume_tokens enable row level security;

-- ポリシーは意図的に作らない（service role のみ読み書き可）。
-- 既に何らかのポリシーが存在する場合に備えて明示的に落とす（冪等・再適用安全）。
do $$
declare p record;
begin
  for p in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'guest_resume_tokens'
  loop
    execute format('drop policy %I on public.guest_resume_tokens', p.policyname);
  end loop;
end $$;

-- 既存のゲスト参加行にも token を発行しておく。
-- 端末側は「JWT が生きている間にセッション画面を開く」ことで受け取り localStorage に控える。
insert into public.guest_resume_tokens (participant_id, token)
select sp.id, gen_random_uuid()::text
from public.session_participants sp
where sp.is_guest = true
on conflict (participant_id) do nothing;

commit;

-- ============================================================================
-- 検証（適用後に実行し、期待値になることを確認）
-- ============================================================================
-- 1) ポリシーが 0 件であること（service role 専用）
-- select count(*) from pg_policies
--  where schemaname='public' and tablename='guest_resume_tokens';
--
-- 2) token 未発行のゲスト行が 0 件であること
-- select count(*) from public.session_participants sp
--  where sp.is_guest = true
--    and not exists (select 1 from public.guest_resume_tokens t where t.participant_id = sp.id);
--
-- 3) token が重複していないこと → 0 行
-- select token, count(*) from public.guest_resume_tokens group by token having count(*) > 1;
