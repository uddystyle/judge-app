-- ============================================================================
-- Migration 1030: Stripe Webhook の冪等化（処理済み event.id の記録）
-- ============================================================================
-- WHY:
--  Stripe は「イベントを少なくとも1回」配信する。順序も保証しない。
--  さらに 2xx 以外を最大3日間再送するため、同一 event.id が複数回届くのは通常運用。
--  本アプリのハンドラは概ね UPSERT で冪等だが、組織アップグレード経路は
--  Stripe 側の `subscriptions.list()` → `cancel()` を伴い、純粋な冪等ではない。
--  処理済み event.id を記録し、2回目以降は即座にスキップする。
-- WHAT:
--  - `stripe_events` テーブルを追加（event_id が主キー）。
--  - RLS 有効・ポリシー無し＝**service role 専用**（1024/1026 と同じパターン）。
--    webhook は service role で書き込むため、アプリのユーザークライアントからは一切見えない。
--  - 古い行の掃除用に created_at の索引を張る（保持期間の運用は別途）。
--
-- 適用順: **DB 先行**。アプリ側は行が無ければ従来どおり処理するだけなので、
--         DB を先に入れてもアプリを先に出しても壊れないが、DB 先行が安全側。
-- 適用対象: prod (scoring-system) と dev (tento-development) の**両方**。
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.stripe_events (
	event_id text PRIMARY KEY,
	event_type text NOT NULL,
	processed_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.stripe_events IS
	'処理済み Stripe Webhook イベントの記録。再送・重複配信時のスキップ判定に使う。service role 専用（RLS有効・ポリシー無し）。';

COMMENT ON COLUMN public.stripe_events.event_id IS
	'Stripe の event.id。主キーなので、INSERT の一意制約違反＝処理済みと判定できる。';

-- service role 専用にする（1024 / 1026 と同じパターン）
ALTER TABLE public.stripe_events ENABLE ROW LEVEL SECURITY;

-- 掃除用（保持期間を超えた行の削除を想定）
CREATE INDEX IF NOT EXISTS idx_stripe_events_processed_at
	ON public.stripe_events (processed_at);

COMMIT;

-- ============================================================================
-- 確認クエリ
--   select relrowsecurity from pg_class where oid = 'public.stripe_events'::regclass;  -- true
--   select count(*) from pg_policies where tablename = 'stripe_events';                -- 0
-- ============================================================================
