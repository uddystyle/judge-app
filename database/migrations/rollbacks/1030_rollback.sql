-- ============================================================================
-- Rollback 1030: stripe_events を撤去する
-- ============================================================================
-- 影響: Webhook の重複配信・再送に対する冪等判定が失われる。
--       多くの経路は UPSERT で冪等なので致命的ではないが、組織アップグレードは
--       Stripe 側の list→cancel を伴うため、再送時に余計な API 呼び出しが発生し得る。
--       アプリ側（stripeEvents.ts の参照）も同時に戻すこと。
-- 冪等: DROP TABLE IF EXISTS のため再実行安全。
-- ============================================================================

BEGIN;

DROP INDEX IF EXISTS public.idx_stripe_events_processed_at;
DROP TABLE IF EXISTS public.stripe_events;

COMMIT;
