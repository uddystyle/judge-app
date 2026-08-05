-- ============================================================================
-- Rollback 1031: stripe_events から処理状態・リース期限・破棄理由を撤去する
-- ============================================================================
-- ⚠️ **これを実行すると 1030 時点の設計欠陥に戻る**。
--    状態列が無くなると「処理を始めた」と「処理を終えた」を区別できなくなり、
--    本処理中に catch を通らず終了した（Vercel の maxDuration 超過・プロセス強制終了・
--    デプロイ）イベントが「処理済み」と判定されて**永久に失われる**。
--    アプリ側（stripeWebhook/idempotency.ts）も同時に戻すこと。
--
-- ⚠️ さらに、撤去前に **status='processing' のまま残っている行**を確認すること。
--    列を落とすと、それらが completed と区別できなくなる（＝未処理のまま永久スキップ）。
--
--      select event_id, event_type, claimed_at from stripe_events
--      where status = 'processing' order by claimed_at;
--
--    該当行があるなら、先に該当イベントを Stripe ダッシュボードから再送するか、
--    行を削除して再送を受け付けられる状態にしてから実行する。
--
-- ⚠️ status='dropped' の行（dead-letter）も、理由が失われて単なる処理済みになる。
--    調査中の破棄イベントがあるなら、先に控えを取ること:
--
--      select event_id, event_type, failure_reason, processed_at
--      from stripe_events where status = 'dropped';
--
-- 冪等: DROP ... IF EXISTS のため再実行安全。
-- ============================================================================

BEGIN;

DROP INDEX IF EXISTS public.idx_stripe_events_processing_claimed_at;

ALTER TABLE public.stripe_events
	DROP CONSTRAINT IF EXISTS stripe_events_status_check;

ALTER TABLE public.stripe_events
	DROP COLUMN IF EXISTS failure_reason,
	DROP COLUMN IF EXISTS claimed_at,
	DROP COLUMN IF EXISTS status;

COMMIT;
