-- ============================================================================
-- Migration 1021: sessions の重複ポリシー整理（最小・安全・挙動ゼロ変化）
-- ============================================================================
-- WHY: 監査整理。prod の sessions には public ロールの own 重複が残る:
--      `Users can delete their own sessions.`(public, auth.uid()=created_by) は
--      `Users can delete own sessions`(authenticated, created_by=get_current_user_id()) と完全等価、
--      `Users can update their own sessions.`(public) も `Users can update own sessions`(authed) と等価。
-- 等価性の根拠: get_current_user_id() は `RETURN auth.uid()`（prod/dev 確認済）。
--      public ロールでも auth.uid()=created_by は anon(uid=null) に何も付与しない。
-- WHAT: 上記 public 重複2本を撤去（authed 版が同じ own 付与を維持＝挙動ゼロ変化）。
-- 注: INSERT `Users can create sessions` / SELECT `Users can view active sessions...` は
--      dev では唯一の own-insert / participant-read（prod の Allow... 系を dev が持たない）ため
--      本 migration では触らない（共有適用で dev を壊さないため）。別途 dev 整合タスクで扱う。
-- DBのみ・冪等（dev には対象が無く no-op）。DEV 先行 → prod。問題時は 1021_rollback.sql。
-- ============================================================================

drop policy if exists "Users can delete their own sessions." on public.sessions;
drop policy if exists "Users can update their own sessions." on public.sessions;

-- 検証（own の DELETE/UPDATE が authed 版で維持され、public 重複が消えていること）
select policyname, cmd, roles::text as roles
from pg_policies
where schemaname = 'public' and tablename = 'sessions' and cmd in ('DELETE', 'UPDATE')
order by cmd, policyname;
