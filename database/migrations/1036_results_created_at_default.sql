-- ============================================================================
-- 1036: results.created_at にデフォルトを付与する（採点日時が一度も記録されていない）
-- ============================================================================
-- 【問題】
-- `results.created_at` は列としては最初から存在するが、**デフォルトが無く、
-- アプリも値を入れていなかった**ため、本番の全 1,127 件が NULL だった。
--
--   participants.created_at … default now() → 517件すべて記録あり
--   sessions.created_at     … default now() → 記録あり
--   results.created_at      … **デフォルト無し** → 1,127件すべて NULL
--
-- これにより次が壊れていた。
--   - Excel エクスポートの日時列が全行 **1970/1/1 9:00:00**
--     （`new Date(null)` は Invalid Date ではなくエポックになる。
--       「1970年に採点された」ように見える本物らしい嘘が並んでいた）
--   - エクスポートの並び順 `.order('created_at')` が全件 NULL で不定
--   - 「いつ採点されたか」がシステム上どこにも残らない（監査不能）
--
-- 【この migration ですること】
-- デフォルトを付けるだけ。**既存行は NULL のまま残す。**
-- 採点日時は失われた情報であり、participants.created_at などから推測して
-- 埋めることはできる。しかし監査対象になり得る列に推測値を入れるのは捏造なので、
-- 「記録が無い」という事実をそのまま残す。
--
-- 【オフライン採点について】
-- オフライン分は後から同期されるため、このデフォルト（now()）だと
-- **同期した時刻**が入ってしまう。アプリ側（scoreSync）で、端末が採点時に記録した
-- 時刻（score_mutations.created_at_local）を明示的に渡すようにしてある。
-- デフォルトが効くのはオンライン採点のみ。
--
-- 冪等。prod / dev の両方に適用する。
-- ロールバック: rollbacks/1036_rollback.sql
-- ============================================================================

begin;

alter table public.results
  alter column created_at set default now();

comment on column public.results.created_at is
  '採点日時。オンライン採点は DB デフォルト、オフライン採点は端末の採点時刻を明示指定する。'
  ' migration 1036 以前の行は NULL（当時は記録されていなかった）。';

-- ⚠️ 死んだ列であることを記録しておく。
-- results.event_id は全 1,127 件が NULL で、アプリは一度も参照していない。
-- 行の特定には (session_id, bib, discipline, level, event_name) を使っている。
-- 「event_id で JOIN すれば速い」と考えて使うと、1件も引けない。
comment on column public.results.event_id is
  '⚠️ 未使用。全行 NULL でアプリも参照していない。行の特定は'
  ' (session_id, bib, discipline, level, event_name) で行う。JOIN に使わないこと。';

commit;

-- 適用後の期待値:
--   results.created_at のデフォルトが now()
--   既存行は NULL のまま（件数は変わらない）
