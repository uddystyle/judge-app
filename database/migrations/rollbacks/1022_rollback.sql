-- ============================================================================
-- Rollback for Migration 1022: tournament_tickets + DB 層強制の撤去
-- ============================================================================
-- 緊急時のみ。tournament_tickets の付与・消費履歴（請求監査データ）が
-- 全て失われることに注意。冪等。
-- 注意: これを撤去すると大会モードのセッション作成が「無条件で可能」に戻る
-- （チケット制の強制が消える）。アプリ側の事前チェックも同時に戻すこと。
-- ============================================================================

begin;

drop trigger if exists trg_consume_tournament_ticket on public.sessions;
drop trigger if exists trg_prevent_tournament_mode_escalation on public.sessions;
drop function if exists public.consume_tournament_ticket();
drop function if exists public.prevent_tournament_mode_escalation();

-- is_organization_member は 052 由来の共有ヘルパーのため削除しない

drop table if exists public.tournament_tickets;

commit;

-- 検証: 0行なら撤去完了
select tgname from pg_trigger
where tgrelid = 'public.sessions'::regclass
  and tgname in ('trg_consume_tournament_ticket', 'trg_prevent_tournament_mode_escalation');
