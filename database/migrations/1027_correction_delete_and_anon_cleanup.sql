-- ============================================================================
-- Migration 1027: 修正要求の DELETE ポリシー整備 ＋ 残る anon SELECT の撤去
-- ============================================================================
-- WHY:
--  (1) 1025 の追加監査で、`training_sessions` に「呼び出し元を参照しない」TO anon の
--      SELECT ポリシーが残っていた（述語は `session_id IN (... where is_guest = true)` で
--      caller に無関係）。anon キーだけで、ゲストが1人でも居るセッションの研修設定が
--      読める。1025 で撤去した anon_* 群と同じクラス。
--  (2) 「修正を要求」フローは対象審判の採点行を削除するが、`training_scores` には
--      authenticated 向けの DELETE ポリシーが**存在しなかった**（1026 で入れたゲスト
--      owner 版のみ）。そのため主任でも認証審判の研修採点を削除できず、アプリは
--      0 行削除でも success を返していた＝機能が黙って効いていなかった。
--      `results` も chief 限定のみで、単独検定員が自分の採点を修正できない。
-- WHAT:
--  (1) training_sessions の anon SELECT を撤去（読み取りは authenticated 側の
--      is_session_participant / creator ポリシーでカバー済み。公開スコアボードは
--      service role 経由なので影響なし）。
--  (2) 自分の採点を消せる owner ポリシーを results / training_scores に追加し、
--      training_scores には主任版も追加（results には既存の
--      chief_judge_can_delete_results がある）。
--      いずれも既存の「自分の行を UPDATE できる」権限より弱い（任意の値に書き換え
--      られるより、消せるほうが弱い）ため、新たな権限拡大にはならない。
-- 適用順: どちらでもよい（アプリは 0 行削除をエラーとして扱う変更を同時に入れるため、
--        DB 先行だと修正要求が先に正しく動くようになる＝安全側）。
-- 冪等。DEV 先行 → prod。問題時は rollbacks/1027_rollback.sql。
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- (1) caller を参照しない anon SELECT の撤去
-- ----------------------------------------------------------------------------
drop policy if exists "Anonymous users can view training sessions" on public.training_sessions;

-- ----------------------------------------------------------------------------
-- (2) 修正要求で採点行を削除できるようにする
-- ----------------------------------------------------------------------------
-- results: 主任は当該セッションの採点を削除できる。
-- prod には存在するが **dev には無い**（手動運用のドリフト。2026-08-04 実測）。
-- 両環境を揃えるため同じ定義で貼り直す（prod では実質 no-op）。
drop policy if exists "chief_judge_can_delete_results" on public.results;
create policy "chief_judge_can_delete_results"
  on public.results
  for delete
  to authenticated
  using (
    exists (
      select 1 from public.sessions
      where sessions.id = results.session_id
        and sessions.chief_judge_id = auth.uid()
    )
  );

-- results: 自分の採点（認証審判）
drop policy if exists "auth_results_delete_by_owner" on public.results;
create policy "auth_results_delete_by_owner"
  on public.results
  for delete
  to authenticated
  using (
    judge_id = auth.uid()
    and session_id in (
      select sp.session_id from public.session_participants sp where sp.user_id = auth.uid()
    )
  );

-- results: 自分の採点（ゲスト）。owner 判定は 1026 のヘルパーに集約
drop policy if exists "guest_results_delete_by_owner" on public.results;
create policy "guest_results_delete_by_owner"
  on public.results
  for delete
  to authenticated
  using (
    guest_identifier is not null
    and guest_identifier = public.current_guest_identifier(session_id)
  );

-- training_scores: 自分の採点（認証審判）
drop policy if exists "auth_training_scores_delete_by_owner" on public.training_scores;
create policy "auth_training_scores_delete_by_owner"
  on public.training_scores
  for delete
  to authenticated
  using (judge_id = auth.uid());

-- training_scores: 主任は当該セッションの採点を削除できる
-- （results の chief_judge_can_delete_results と対称）
drop policy if exists "chief_training_scores_delete" on public.training_scores;
create policy "chief_training_scores_delete"
  on public.training_scores
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.training_events te
      join public.sessions s on s.id = te.session_id
      where te.id = training_scores.event_id
        and s.chief_judge_id = auth.uid()
    )
  );

commit;

-- ============================================================================
-- 検証（適用後に実行）
-- ============================================================================
-- 1) training_sessions に anon ポリシーが残っていないこと → 0 行
-- select policyname from pg_policies
--  where schemaname='public' and tablename='training_sessions' and roles::text like '%anon%';
--
-- 2) 削除ポリシーが results 3本 / training_scores 3本 そろっていること
-- select tablename, policyname, roles::text from pg_policies
--  where schemaname='public' and tablename in ('results','training_scores') and cmd='DELETE'
--  order by tablename, policyname;
