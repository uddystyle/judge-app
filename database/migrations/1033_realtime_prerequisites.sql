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
--  ⚠️ REPLICA IDENTITY FULL の効果を **DELETE に期待してはいけない**。
--  Supabase 公式ドキュメントの記述:
--    "RLS policies are not applied to DELETE statements, because there is no way for
--     Postgres to verify that a user has access to a deleted record. When RLS is enabled
--     and replica identity is set to full on a table, the old record contains only the
--     primary key(s)."
--  つまり RLS 有効なテーブルでは、FULL にしても DELETE の old には**主キーしか入らない**。
--  DELETE の payload に依存した差分更新は成立しないため、アプリ側は DELETE 受信時に
--  正規状態を再取得する方式にしてある（scoreStatusManager）。
--  FULL が実際に効くのは **UPDATE の old** で、こちらは全列が入る。
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
		-- ⚠️ 存在しないテーブルを黙って飛ばしてはいけない。
		-- 「適用済み」として記録されるのに何も設定されていない環境が生まれ、
		-- 後からテーブルを作っても publication は自動で付かない。
		-- 復旧環境で前提条件を保証するのが目的なので、欠けていたら失敗させる。
		IF to_regclass('public.' || t) IS NULL THEN
			RAISE EXCEPTION 'テーブル public.% が存在しません。先にテーブルを作成してから 1033 を適用すること', t;
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
