-- ============================================================================
-- Migration 1025: ゲストの身元を auth.uid() 束縛へ移行し、user_metadata 依存を全廃
-- ============================================================================
-- WHY: ゲスト（匿名サインインで参加する検定員）の認可が、2つの誤った前提の上に
--      作られていた。
--      (1) 「ゲスト＝anon ロール」: Supabase の匿名サインインユーザーは永続ユーザーと
--          同じ authenticated ロールを使う（anon ロールは「ユーザー無しの anon API
--          キー」用）。そのため TO anon で作られた anon_*_by_jwt 群はゲストに一度も
--          発火しない。一方 authenticated 側の書込みポリシーは judge_id = auth.uid()
--          とセッション参加(session_participants.user_id)を要求するが、ゲストは
--          guest_identifier 運用で user_id が NULL だった。
--          → ゲストはセッションの読取りも採点の保存もできない（可用性の障害）。
--      (2) 「ゲストの身元＝JWT の user_metadata」: user_metadata(raw_user_meta_data)は
--          本人が supabase.auth.updateUser({data}) で書き換えられる。これを認可に
--          使っていたため、同一セッションの参加者が他ゲストの guest_identifier を
--          読んで詐称し、参加行の改変・削除ができた（なりすまし）。
-- WHAT:
--      1. session_participants.user_id にゲストの匿名 uid をバックフィル。以後は
--         アプリが join / 招待 / ?guest= 再採用の各経路で束縛する（アプリ先行）。
--      2. 偽造可能な user_metadata 句を session_participants の UPDATE/DELETE から撤去。
--      3. 発火しない anon_*_by_jwt 群（15本）を撤去。読取りは既存の authenticated
--         ポリシー（is_session_member / is_session_participant はいずれも
--         user_id = auth.uid() 基準）で束縛済みゲストが自動的に通るため、置換不要。
--      4. 唯一の穴だった「ゲスト owner（guest_identifier）での採点書込み」に、
--         auth.uid() 束縛を根拠にした authenticated ポリシーを新設。
--         判定は SECURITY DEFINER の current_guest_identifier() に集約する。
-- 適用順: **アプリ先行**。user_id を埋めるアプリを先にデプロイしてから本 SQL を適用する
--         （逆順だと、本 SQL 適用後にアプリ未デプロイのまま参加した新規ゲストが
--         user_id 無しとなり、どのポリシーにも当たらず何もできない）。
-- 冪等。DEV 先行 → prod。問題時は rollbacks/1025_rollback.sql。
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- (1) 既存ゲスト行の user_id バックフィル
-- ----------------------------------------------------------------------------
-- 匿名ユーザーの raw_user_meta_data.guest_identifier と突き合わせる。
-- 再採用のたびに新しい匿名ユーザーが作られるため、同一 guest_identifier に複数の
-- uid が対応しうる。最後に作られたものを採用する（＝最後に再採用した端末）。
-- guest_identifier は idx_session_participants_guest_identifier_unique により
-- 全体で一意なので、1 gid → 高々1行。(session_id, user_id) の部分ユニークにも当たらない。
with latest_anon as (
  select distinct on (u.raw_user_meta_data ->> 'guest_identifier')
         u.raw_user_meta_data ->> 'guest_identifier' as gid,
         u.id                                        as uid
  from auth.users u
  where u.is_anonymous
    and coalesce(u.raw_user_meta_data ->> 'guest_identifier', '') <> ''
  order by u.raw_user_meta_data ->> 'guest_identifier', u.created_at desc
)
update public.session_participants sp
   set user_id = latest_anon.uid
  from latest_anon
 where sp.is_guest = true
   and sp.user_id is null
   and sp.guest_identifier = latest_anon.gid;

-- ----------------------------------------------------------------------------
-- (2) ゲスト owner 判定のヘルパ
-- ----------------------------------------------------------------------------
-- auth.uid() に束縛された参加行の guest_identifier を返す（無ければ NULL）。
-- SECURITY DEFINER は session_participants の RLS を介さず引くためだが、返すのは
-- 「呼び出し元自身の束縛」だけなので、public から実行可能でも情報漏洩にならない。
create or replace function public.current_guest_identifier(p_session_id bigint)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select sp.guest_identifier
  from public.session_participants sp
  where sp.session_id = p_session_id
    and sp.user_id = auth.uid()
    and sp.is_guest = true
  limit 1
$$;

comment on function public.current_guest_identifier(bigint) is
  'auth.uid() に束縛されたゲスト参加行の guest_identifier。RLS でゲスト owner を判定するための唯一の入口（JWT クレームは信頼しない）。';

-- 実行権限は authenticated だけに絞る。本関数を使うポリシーは全て TO authenticated
-- なので anon から呼べる必要はない（Supabase advisor の
-- anon_security_definer_function_executable 対策。既存ヘルパ群より厳しくしてある）。
-- ※ Supabase は anon/authenticated/service_role へ個別に EXECUTE を付与するため、
--   PUBLIC から revoke するだけでは anon の権限が残る。anon からも明示的に revoke する。
revoke all on function public.current_guest_identifier(bigint) from public;
revoke execute on function public.current_guest_identifier(bigint) from anon;
grant execute on function public.current_guest_identifier(bigint) to authenticated;

-- ----------------------------------------------------------------------------
-- (3) 偽造可能な user_metadata 句の撤去（なりすましの本丸）
-- ----------------------------------------------------------------------------
-- 旧: (auth.uid() = user_id) OR (is_guest AND guest_identifier = jwt.user_metadata.guest_identifier)
--     後半はクライアントが書き換えられるうえセッションスコープも無かった。
drop policy if exists "Users and guests can update their own participation" on public.session_participants;
create policy "Users and guests can update their own participation"
  on public.session_participants
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "Owner, session manager, or org admin can delete participation" on public.session_participants;
create policy "Owner, session manager, or org admin can delete participation"
  on public.session_participants
  for delete
  to authenticated
  using (
    user_id = auth.uid()
    or public.can_manage_session_participants(session_id)
  );

-- ----------------------------------------------------------------------------
-- (4) 発火しない anon_*_by_jwt 群の撤去
-- ----------------------------------------------------------------------------
-- ゲストは authenticated ロールで来るため、これらは一度も評価されない。
-- 読取りは既存の authenticated ポリシーで束縛済みゲストが通る（(1) の後）。
-- 公開スコアボードは service role 経由（scoreboard/[sessionId]/+page.server.ts）
-- のため、anon ポリシー撤去の影響を受けない。
-- ※ dev では同名ポリシーが app_metadata 参照へ書き換えられているが、名前が同じなので
--   同じ DROP でどちらの環境も一掃できる。
drop policy if exists "anon_sessions_select_by_jwt"                on public.sessions;
drop policy if exists "anon_session_participants_select_by_jwt"    on public.session_participants;
drop policy if exists "anon_participants_select_by_jwt"            on public.participants;
drop policy if exists "anon_participants_insert_by_jwt"            on public.participants;
drop policy if exists "anon_custom_events_select_by_jwt"           on public.custom_events;
drop policy if exists "anon_scoring_prompts_by_jwt"                on public.scoring_prompts;
drop policy if exists "anon_results_select_scoped_by_jwt"          on public.results;
drop policy if exists "anon_results_insert_by_owner"               on public.results;
drop policy if exists "anon_results_update_by_owner"               on public.results;
drop policy if exists "anon_training_scores_select_scoped_by_jwt"  on public.training_scores;
drop policy if exists "anon_training_scores_insert_scoped_by_jwt"  on public.training_scores;
drop policy if exists "anon_training_scores_update_scoped_by_jwt"  on public.training_scores;
drop policy if exists "anon_training_scores_delete_scoped_by_jwt"  on public.training_scores;

-- prod では USING true（＝anon キーだけで全セッションの種目が読めた）。dev は
-- app_metadata でスコープ済み。どちらも不要なので撤去する。
drop policy if exists "Anonymous users can view training events"   on public.training_events;

-- ----------------------------------------------------------------------------
-- (5) ゲスト owner での採点書込み（唯一残る穴を塞ぐ）
-- ----------------------------------------------------------------------------
-- 既存の authenticated 書込みポリシーは judge_id = auth.uid() を要求するため、
-- guest_identifier を owner 列に使うゲストは通れない。uid 束縛を根拠に許可する。
drop policy if exists "guest_results_insert_by_owner" on public.results;
create policy "guest_results_insert_by_owner"
  on public.results
  for insert
  to authenticated
  with check (
    guest_identifier is not null
    and guest_identifier = public.current_guest_identifier(session_id)
  );

drop policy if exists "guest_results_update_by_owner" on public.results;
create policy "guest_results_update_by_owner"
  on public.results
  for update
  to authenticated
  using (
    guest_identifier is not null
    and guest_identifier = public.current_guest_identifier(session_id)
  )
  with check (
    guest_identifier is not null
    and guest_identifier = public.current_guest_identifier(session_id)
  );

drop policy if exists "guest_training_scores_insert_by_owner" on public.training_scores;
create policy "guest_training_scores_insert_by_owner"
  on public.training_scores
  for insert
  to authenticated
  with check (
    guest_identifier is not null
    and exists (
      select 1
      from public.training_events te
      where te.id = training_scores.event_id
        and training_scores.guest_identifier = public.current_guest_identifier(te.session_id)
    )
  );

drop policy if exists "guest_training_scores_update_by_owner" on public.training_scores;
create policy "guest_training_scores_update_by_owner"
  on public.training_scores
  for update
  to authenticated
  using (
    guest_identifier is not null
    and exists (
      select 1
      from public.training_events te
      where te.id = training_scores.event_id
        and training_scores.guest_identifier = public.current_guest_identifier(te.session_id)
    )
  )
  with check (
    guest_identifier is not null
    and exists (
      select 1
      from public.training_events te
      where te.id = training_scores.event_id
        and training_scores.guest_identifier = public.current_guest_identifier(te.session_id)
    )
  );

drop policy if exists "guest_training_scores_delete_by_owner" on public.training_scores;
create policy "guest_training_scores_delete_by_owner"
  on public.training_scores
  for delete
  to authenticated
  using (
    guest_identifier is not null
    and exists (
      select 1
      from public.training_events te
      where te.id = training_scores.event_id
        and training_scores.guest_identifier = public.current_guest_identifier(te.session_id)
    )
  );

commit;

-- ============================================================================
-- 検証（適用後に実行し、3件とも期待値になることを確認）
-- ============================================================================
-- 1) user_metadata を認可に使うポリシーが残っていないこと → 0 行
-- select tablename, policyname from pg_policies
--  where schemaname='public'
--    and (coalesce(qual,'')||coalesce(with_check,'')) ilike '%user_metadata%';
--
-- 2) ゲスト行の user_id 充足率（bound が全件に近いこと。突合不能な古い行は残る）
-- select count(*) filter (where user_id is not null) as bound,
--        count(*) as total
--   from public.session_participants where is_guest;
--
-- 3) 新ポリシーが 5 本そろっていること → 5 行
-- select tablename, policyname, cmd from pg_policies
--  where schemaname='public' and policyname like 'guest_%_by_owner' order by 1,2;
