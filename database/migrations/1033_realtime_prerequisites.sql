-- ============================================================================
-- Migration 1033: Realtime の DB 前提条件を正規のマイグレーションで保証する
-- ============================================================================
-- WHY:
--  Realtime（Postgres Changes）が動くには、対象テーブルが
--    (1) publication `supabase_realtime` に含まれている
--    (2) REPLICA IDENTITY FULL である（DELETE の old データを配信するために必要）
--  の2条件を満たす必要がある。しかし本リポジトリでは、これらを設定するのが
--    - `999_fix_rls_realtime_security.sql` … **台帳で「❌実行禁止（DO NOT RUN）」**
--    - `scripts/apply-realtime-setup.sql`  … 手動実行のスクリプト
--  だけで、**通常のマイグレーション適用経路に存在しなかった**。
--
--  現行の prod / dev は手動適用済みだが（2026-08-05 実測: 3テーブルとも
--  replica_identity='f' かつ publication 収録済み）、**新規環境・復旧環境では
--  Realtime が無言で無配信になる**。しかも購読自体は成功するため、
--  「繋がっているのにイベントが来ない」という気づきにくい壊れ方をする。
--
--  REPLICA IDENTITY FULL は DELETE payload に必要列を載せるためにも要る。
--  Postgres Changes の DELETE はフィルターが効かないため、old データが取れないと
--  「どの行が消えたか」をクライアントが判定できない。
--
-- WHAT:
--  publication への追加と REPLICA IDENTITY FULL を冪等に適用する。
--  既に設定済みの環境では何も変わらない（現行 prod/dev は no-op）。
--
-- 適用対象: prod / dev の両方（no-op）。本質的な価値は**新規・復旧環境**にある。
-- ============================================================================

BEGIN;

DO $$
DECLARE
	t text;
BEGIN
	FOREACH t IN ARRAY ARRAY['training_scores', 'results', 'sessions'] LOOP
		-- テーブルが存在しない環境（部分構築中など）では黙って飛ばす
		IF to_regclass('public.' || t) IS NULL THEN
			RAISE NOTICE 'skip %: table does not exist', t;
			CONTINUE;
		END IF;

		-- (1) publication に追加（未収録のときだけ）
		IF NOT EXISTS (
			SELECT 1 FROM pg_publication_tables
			WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
		) THEN
			EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
			RAISE NOTICE 'added % to supabase_realtime', t;
		END IF;

		-- (2) REPLICA IDENTITY FULL（'f' 以外のときだけ）
		IF (SELECT relreplident FROM pg_class WHERE oid = ('public.' || t)::regclass) <> 'f' THEN
			EXECUTE format('ALTER TABLE public.%I REPLICA IDENTITY FULL', t);
			RAISE NOTICE 'set REPLICA IDENTITY FULL on %', t;
		END IF;
	END LOOP;
END $$;

COMMIT;

-- ============================================================================
-- 確認は verify/1033_verify_realtime_prerequisites.sql を実行すること。
-- 期待: 3テーブルすべて published=true かつ replica_identity='f'。
-- ============================================================================
