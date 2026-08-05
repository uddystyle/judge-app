-- ============================================================================
-- Migration 1031: stripe_events に処理状態とリース期限、破棄理由を持たせる
-- ============================================================================
-- WHY:
--  (1) **1030 の設計欠陥（イベントの永久消失）**
--      1030 は本処理の前に INSERT し、その瞬間から同じ event.id を「処理済み」と判定していた。
--      失敗時は catch で行を削除する作りだったため、**catch を通らない終了**では記録が残り続ける:
--        INSERT 成功 → 本処理中に Vercel タイムアウト（maxDuration=10s）/ プロセス強制終了 /
--        デプロイによる入れ替え → Stripe が再送 → 一意制約違反 → 「処理済み」と判定 →
--        **そのイベントは二度と処理されない**（＝課金イベントの永久消失）。
--      とくに組織アップグレード経路は Stripe の list + 複数 cancel を伴い 10 秒に迫りやすい。
--  (2) **破棄したイベントを追跡できない**
--      再送しても成功しない種類のエラーは 200 を返して再送を止めるが（M-1）、
--      記録が event_id と type だけなので「なぜ破棄したか」がログにしか残らない。
--      課金済みイベントを破棄した場合、ログが失われると再処理の手がかりが無い。
-- WHAT:
--  - `status`: processing / completed / dropped。**completed と dropped だけを永久スキップ**する。
--  - `claimed_at`: 処理権を取得した時刻。**古い processing はリース切れとして再取得できる**。
--  - `failure_reason`: 破棄理由。status='dropped' の行が dead-letter レコードになる。
--    payload 自体は保存しないが、event_id があれば Stripe API から再取得・再構築できる。
--  - 部分索引: リース切れ processing の走査用。
--
-- リース期間はアプリ側の定数（stripeWebhook/idempotency.ts の LEASE_MS）で判定する。
-- Vercel の maxDuration が 10 秒なので、実行中の処理がリース切れになることは無い
-- （ハード上限の数倍を取る）。上限を伸ばす場合は LEASE_MS も見直すこと。
--
-- 適用順: **DB 先行**。アプリは status/claimed_at を読み書きするため、先に列が必要。
-- 適用対象: prod (scoring-system) と dev (tento-development) の**両方**。
-- ============================================================================

BEGIN;

ALTER TABLE public.stripe_events
	ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'completed',
	ADD COLUMN IF NOT EXISTS claimed_at timestamptz NOT NULL DEFAULT now(),
	ADD COLUMN IF NOT EXISTS failure_reason text;

-- 既存行（1030 適用後に処理済みとなったもの）は completed 扱いで問題ない
ALTER TABLE public.stripe_events
	DROP CONSTRAINT IF EXISTS stripe_events_status_check;

ALTER TABLE public.stripe_events
	ADD CONSTRAINT stripe_events_status_check
	CHECK (status IN ('processing', 'completed', 'dropped'));

COMMENT ON COLUMN public.stripe_events.status IS
	'processing=処理中（リース切れなら再取得可） / completed=正常終了 / dropped=再送しても成功しないため破棄（dead-letter）。永久スキップするのは completed と dropped のみ。';

COMMENT ON COLUMN public.stripe_events.claimed_at IS
	'処理権を取得した時刻。processing のままこの時刻が古い行は、処理中の異常終了とみなして再取得できる。';

COMMENT ON COLUMN public.stripe_events.failure_reason IS
	'status=dropped のときの破棄理由。payload は保存しないが、event_id から Stripe API で再取得できる。';

-- リース切れ processing の走査用（件数は少ないが、意図を索引で明示する）
CREATE INDEX IF NOT EXISTS idx_stripe_events_processing_claimed_at
	ON public.stripe_events (claimed_at)
	WHERE status = 'processing';

COMMIT;

-- ============================================================================
-- 運用クエリ
--   -- 破棄されたイベント（要調査。event_id から Stripe API で内容を再取得できる）
--   select event_id, event_type, failure_reason, processed_at
--   from stripe_events where status = 'dropped' order by processed_at desc;
--
--   -- 処理中のまま取り残された行（リース切れ。次の再送で自動的に再取得される）
--   select * from stripe_events
--   where status = 'processing' and claimed_at < now() - interval '1 minute';
-- ============================================================================
