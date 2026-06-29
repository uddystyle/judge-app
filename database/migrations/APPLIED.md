# マイグレーション適用台帳 (APPLIED.md)

> 最終更新: 2026-06-29 ／ 自動生成(ヘッダ抽出)＋手動オーバーレイ。`database/migrations/` の全 106 SQL を網羅。

## 1. 前提・凡例

- このプロジェクトには**自動マイグレーションランナーが無い**。SQL は Supabase SQL Editor で**手動適用**され、`schema_migrations` テーブルも CI も存在しない。
- **ファイル名の番号は適用順を保証しない**（`001` は4ファイルが別概念で衝突するなど）。順序・依存は各行の「備考」と本台帳を参照すること。
- **prod / dev の2DBは手動運用で既にドリフト**している。適用状況は DB ごとに別管理する。
- このファイルは**記述専用**。SQL は実行しない。新規適用・改名・移動の判断材料として使う。
- **ディレクトリ構成**（整理 Phase 1–2 適用後）: 前進マイグレーションは `database/migrations/` 直下、ロールバックは `rollbacks/`、マイグレーション検証は `verify/`、未実装は `planned/`、破壊的な一回限りスクリプトは `archive/one-time/`、汎用診断は `database/diagnostics/`。放棄された旧 RLS 最適化トラックは `database/archive/2025-12-rls-perf-optimization/`。

**記号**

| 記号 | 意味 |
|---|---|
| ✅ | 当該DBに適用済み（todo.md 運用ログ／memory の監査記録で確認） |
| ⚠️要確認 | 適用状況がリポジトリから確定できない。§6 のクエリで実測して昇格する |
| 🔴未適用疑い | 適用されていない可能性が高い（スキーマ実測で列/ポリシー欠落） |
| ❌実行禁止 | DEPRECATED もしくは PLANNED。実行してはいけない |
| —(対象無/no-op) | 当該DBには対象が無く実行しても変化しない |
| 冪等 ✓ / ⚠️注意 | 再実行安全 / 無ガードの CREATE 等で再実行エラーの可能性 |

## 2. ⚠️ 重要フラグ（最優先で確認）

| ファイル | 種別 | 状況 | 内容 |
|---|---|---|---|
| `999_fix_rls_realtime_security.sql` | deprecated | ❌実行禁止 | ヘッダに "DO NOT RUN"。`1000` で置換済み。参照7箇所(realtime/security docs等)のため**物理移動は見送り**・本台帳で隔離扱い |
| `planned/1001_add_judge_id_to_results.sql` | planned | ❌未実装 | "Status: PLANNED / NOT READY"・BREAKING。本番未適用。→ `database/migrations/planned/` へ隔離済み |
| `001_add_session_security.sql` | forward | 🔴 prod未適用疑い | `failed_join_attempts`/`is_locked` が prod に無い疑い＝参加コード join で500の可能性。§6で要実測 |
| `archive/one-time/008_phase0_cleanup_existing_data.sql` | cleanup | 💥破壊的・一回限り | 全テーブル TRUNCATE。本番未稼働時の再構築用。**再実行厳禁**。→ `archive/one-time/` へ隔離済み |
| `archive/one-time/010_cleanup_existing_user_data.sql` | cleanup | 💥破壊的・一回限り | 組織/セッションを TRUNCATE。**再実行厳禁**。→ `archive/one-time/` へ隔離済み |

## 3. 前進マイグレーション台帳

### 3.1 初期era（0000–056・60本）

> 注: この期間は同一テーブルへの RLS 修正の繰り返し（fix-on-fix）が多く、後続が前を上書き（supersedes）している。多くは後年の状態に吸収済み。

| # | ファイル | 概要 | 日付 | 冪等 | 関連/supersedes | dev | prod | 備考 |
|---|---|---|---|:--:|---|:--:|:--:|---|
| 0 | `0000_base_sessions_schema.sql` | sessionsテーブルの参照ベーススキーマ復元 | 2026-06-27 | ✓ |  | ⚠️要確認 | ⚠️要確認 | 新規DB再構築のベースライン(001適用前)。FKは scoring_prompts/organizations/auth.users 先行必須。既存DBはno-op |
| 1 | `001_add_session_security.sql` | sessionsに参加ロック用2列を追加 |  | ✓ |  | ⚠️要確認 | 🔴未適用疑い | ADD COLUMN IF NOT EXISTSで追加のみ・アプリ変更不要。prod未適用の疑い(参加コードjoinが500になる原因) |
| 1 | `001_add_subscription_tables.sql` | サブスク/プラン制限/使用量テーブル追加 |  | ⚠️注意 |  | ⚠️要確認 | ⚠️要確認 | subscriptions/plan_limits/usage_limits。テーブルはIF NOT EXISTSだがCREATE POLICY無ガードで再実行エラー。Stripe前提 |
| 1 | `001_add_tournament_mode.sql` | 大会モード(種目/参加者)機能を追加 | 2025-10-25 | ⚠️注意 |  | ⚠️要確認 | ⚠️要確認 | sessionsに3列+custom_events/participants+RLS。ADD CONSTRAINT valid_score_calculation無ガードで再実行エラー |
| 2 | `002_add_session_notifications.sql` | セッション通知テーブルを追加 | 2025-10-26 | ⚠️注意 |  | ⚠️要確認 | ⚠️要確認 | session_notifications+RLS。ADD CONSTRAINT/CREATE POLICY無ガードで再実行エラー。session_participants前提 |
| 3 | `003_add_notification_cleanup.sql` | 古い通知の自動削除トリガー追加 | 2025-10-26 | ✓ |  | ⚠️要確認 | ⚠️要確認 | session_notificationsへAFTER INSERTで1h超の旧通知を自動削除。CREATE OR REPLACE+DROP TRIGGER IF EXISTS。002の後 |
| 4 | `004_add_training_mode.sql` | 研修モード機能とmode列を追加 | 2025-11-01 | ✓ |  | ⚠️要確認 | ⚠️要確認 | mode列+training_sessions/events/scores+RLS。participants(001大会)前提。制約はDO内で存在チェックし冪等 |
| 5 | `005_add_multi_judge_to_training.sql` | training_sessionsにis_multi_judge列を追加 | 2025-11-01 | ✓ |  | ⚠️要確認 | ⚠️要確認 | ADD COLUMN IF NOT EXISTS のみ。安全に再実行可。複数検定員モード用フラグ |
| 6 | `006_fix_training_scores_judge_id.sql` | training_scores再作成・judge_idをusers参照に変更 | 2025-11-01 | ✓ |  | ⚠️要確認 | ⚠️要確認 | **💥破壊的 破壊変更** DROP TABLE CASCADEで旧データ消失。judge_id参照をparticipants→auth.users UUID化。RLS再定義 |
| 7 | `007_add_organization_features.sql` | 組織・メンバー・招待テーブルを新規作成 | 2025-11-05 | ✓ |  | ⚠️要確認 | ⚠️要確認 | ヘッダ「Supabase SQL Editorで実行」。CREATE TABLE/POLICYは全てIF付き。RLS一括設定 |
| 7 | `007_fix_rls_infinite_recursion.sql` | organization_members RLS無限再帰を修正 | 2025-11-06 | ✓ | 007_add_organization_features (org_members policies) | ⚠️要確認 | ⚠️要確認 | is_organization_admin関数(SECURITY DEFINER)で再帰回避。007作成のポリシーを置換するパッチ |
| 9 | `009_phase1_rebuild_database_structure.sql` | organization_id NOT NULL化・plan_limits再構築 | 2025-11-07 | ✓ |  | ⚠️要確認 | ⚠️要確認 | **💥破壊的 破壊変更** Phase1。008(Phase0)実行後に。plan_type制約変更・sessions/subs SET NOT NULL・orphan subs削除 |
| 10 | `010_add_guest_user_support.sql` | ゲスト参加機能(招待トークン・guest列)を追加 | 2025-01-11 | ⚠️注意 |  | ⚠️要確認 | ⚠️要確認 | **破壊変更** session_participants主キー再構築・user_id NOT NULL解除。一部CREATE POLICY未ガードで再実行不可 |
| 11 | `011_fix_organizations_rls_policy.sql` | organizations RLSにINSERT等ポリシー追加 |  | ✓ | 007_add_organization_features (organizations policies) | ⚠️要確認 | ⚠️要確認 | 認証ユーザーが組織作成可に。DROP IF EXISTS後CREATE。末尾pg_policies確認SELECT(スキーマ変更なし) |
| 12 | `012_fix_organization_members_rls_policy.sql` | organization_members RLSポリシーを再構築 |  | ✓ | 007_fix_rls_infinite_recursion (org_members) | ⚠️要確認 | ⚠️要確認 | INSERT/SELECT/UPDATE/DELETE再定義。自己参照サブクエリで再帰懸念(007_fixの関数方式に戻す)。末尾確認SELECT |
| 13 | `013_cleanup_duplicate_policies.sql` | org_members重複RLSポリシー削除 |  | ✓ |  | ⚠️要確認 | ⚠️要確認 | DROP POLICY IF EXISTSのみ＋確認SELECT。データ削除なし(cleanupは名のみ) |
| 14 | `014_fix_rls_infinite_recursion.sql` | org_members無限再帰INSERTポリシー削除 |  | ✓ |  | ⚠️要確認 | ⚠️要確認 | 再帰する追加ポリシーを削除。既存『Users can create own membership』に依存 |
| 15 | `015_complete_rls_reset.sql` | org_members RLS完全リセット |  | ✓ |  | ⚠️要確認 | ⚠️要確認 | **破壊変更** DOループで全ポリシー削除し再作成、RLS有効化。016で再リセットされる |
| 16 | `016_simplest_rls_policy.sql` | org_members RLS最簡素化(SELECT全許可) |  | ✓ | 015 | ⚠️要確認 | ⚠️要確認 | **破壊変更** 再帰回避でSELECTをUSING(true)に。DOループ全削除→再作成。015を置換 |
| 17 | `017_fix_organizations_rls.sql` | organizations RLS全許可化 |  | ✓ |  | ⚠️要確認 | ⚠️要確認 | **破壊変更** 全操作authenticatedにtrue許可。DOループ全削除→再作成。後に020で組織ベース化 |
| 18 | `018_organization_based_rls.sql` | Phase6 組織ベースRLS全面見直し |  | ⚠️注意 | 016/017 | ⚠️要確認 | ⚠️要確認 | **破壊変更** sessions/participants/orgs/org_members更新。新名ポリシーはIF NOT EXISTSなしで再実行不可 |
| 19 | `019_fix_organization_members_rls.sql` | org_members RLS再修正(SELECT全許可) |  | ✓ | 018 | ⚠️要確認 | ⚠️要確認 | **破壊変更** 018の再帰回避でSELECT USING(true)に戻す。drop名と作成名一致で再実行可。018を置換 |
| 20 | `020_fix_organizations_policies.sql` | organizations RLSメンバーベース化 |  | ⚠️注意 | 017/018 | ⚠️要確認 | ⚠️要確認 | **破壊変更** 作成は全authenticated、閲覧/更新/削除はメンバー/admin。新名ポリシーで再実行不可 |
| 21 | `021_fix_profiles_rls.sql` | profiles RLS自分のみ許可 |  | ✓ |  | ⚠️要確認 | ⚠️要確認 | id=auth.uid()でSELECT/INSERT/UPDATE作成。RLS有効化含む。drop名と作成名一致 |
| 22 | `022_fix_session_participants_rls.sql` | session_participants RLS簡素化 |  | ⚠️注意 | 018 | ⚠️要確認 | ⚠️要確認 | **破壊変更** SELECTをUSING(true)に緩和(組織制御はsessions側)。新名ポリシーで再実行不可。018を置換 |
| 23 | `023_create_contact_submissions.sql` | お問い合わせ送信テーブルを新規作成 |  | ✓ |  | ⚠️要確認 | ⚠️要確認 | CREATE TABLE/INDEX IF NOT EXISTS・OR REPLACE採用。ただしtrigger/policyは無ガードで再実行時に重複エラーの可能性。public INSERT許可 |
| 24 | `024_fix_scoring_prompts_rls.sql` | scoring_promptsのRLS修正(匿名SELECT許可) | 2025-01-12 | ✓ |  | ⚠️要確認 | ⚠️要確認 | **破壊変更** DO loopで既存ポリシー全削除し再作成。authenticated/anonのSELECT等をUSING(true)へ。RLS基盤を変更 |
| 25 | `025_fix_scoring_prompts_session_id_type.sql` | scoring_prompts.session_id/idをUUID化 | 2025-01-12 | ✓ |  | ⚠️要確認 | ⚠️要確認 | **💥破壊的 破壊変更** FK制約削除+TRUNCATEで全件削除後にbigint→UUID型変更しFK再作成。既存データ消失する破壊的変更 |
| 26 | `026_fix_sessions_active_prompt_id_fkey.sql` | active_prompt_idのFKをscoring_promptsに修正 | 2025-01-12 | ✓ |  | ⚠️要確認 | ⚠️要確認 | **破壊変更** 誤ったFK(profiles参照)をDROP IF EXISTSで削除し正しいFK(scoring_prompts)再作成。型がUUIDでなければ変更 |
| 27 | `027_add_results_delete_policy.sql` | resultsにDELETEポリシー追加(主任検定員のみ) |  | ⚠️注意 |  | ⚠️要確認 | ⚠️要確認 | CREATE POLICYのみで無ガード(再実行で重複エラー)。chief_judge_idのみ削除可、anonはポリシー無で削除不可 |
| 28 | `028_fix_custom_events_rls.sql` | custom_eventsのSELECTを全認証ユーザー許可へ |  | ✓ |  | ⚠️要確認 | ⚠️要確認 | **破壊変更** 暫定対応:旧SELECTポリシー削除しUSING(true)化。新ポリシーは無ガードで再実行注意。TODO要再制限 |
| 29 | `029_fix_custom_events_insert_update_policies.sql` | custom_eventsの書込RLSを暫定緩和 |  | ✓ |  | ⚠️要確認 | ⚠️要確認 | **破壊変更** created_by型不一致回避の暫定。旧INSERT/UPDATE/DELETE削除し全authenticatedにtrue付与。新ポリシー無ガード |
| 30 | `030_fix_tournament_tables_session_id_type.sql` | sessions.id等をUUID→bigintに戻し本番と統一 | 2025-11-12 | ✓ | 025, 026 | ⚠️要確認 | ⚠️要確認 | **💥破壊的 破壊変更** WARNING:全session系データTRUNCATE。FK削除+id型UUID→bigint+RLS全再構築。025/026のUUID化を逆転 |
| 31 | `031_add_missing_session_participants_insert_policy.sql` | session_participantsにINSERTポリシー追加(認証+匿名) | 2025-11-12 | ⚠️注意 |  | ⚠️要確認 | ⚠️要確認 | 030でINSERTポリシー再作成漏れの補填。CREATE POLICYのみ無ガード(再実行で重複エラー) |
| 32 | `032_add_guest_invite_policy.sql` | 匿名がinvite_tokenでsessions閲覧可能に | 2025-11-12 | ⚠️注意 |  | ⚠️要確認 | ⚠️要確認 | 追加のみ・無ガード。anonにinvite_token IS NOT NULLでSELECT許可(匿名露出が増える点に留意) |
| 33 | `033_add_participants_rls_policies.sql` | participants RLSポリシー追加(030漏れ補完) | 2025-11-12 | ⚠️注意 |  | ⚠️要確認 | ⚠️要確認 | auth/anonにSELECT、authにINS/UPD/DEL。CREATE POLICYのみで再実行不可。034で置換される |
| 34 | `034_fix_participants_policies.sql` | participants RLSを正仕様に再作成 | 2025-11-12 | ✓ | 033 | ⚠️要確認 | ⚠️要確認 | **破壊変更** 033のポリシーをDROP IF EXISTS後、SELECTをセッション参加者基準、書込を作成者/主任検定員基準に変更(RLS基準変更)。anonは全件閲覧 |
| 35 | `035_fix_guest_session_access.sql` | sessions anonをinvite tokenから全件閲覧へ | 2025-11-12 | ✓ |  | ⚠️要確認 | ⚠️要確認 | **破壊変更** invite tokenポリシーをDROPしanon SELECT USING(true)に置換(RLS基準変更/セキュリティ緩和)。join_code等露出リスク |
| 36 | `036_add_guest_scoring_prompts_access.sql` | scoring_prompts anon SELECT追加 | 2025-11-12 | ⚠️注意 |  | ⚠️要確認 | ⚠️要確認 | anon USING(true)。CREATE POLICYのみで再実行不可。039で再作成される |
| 37 | `037_add_guest_custom_events_access.sql` | custom_events anon SELECT追加 | 2025-11-12 | ⚠️注意 |  | ⚠️要確認 | ⚠️要確認 | anon USING(true)。CREATE POLICYのみで再実行不可。038/039で作り直される |
| 38 | `038_verify_and_fix_guest_custom_events_access.sql` | custom_events anon SELECTを再作成(確認込) | 2025-11-13 | ✓ | 037 | ⚠️要確認 | ⚠️要確認 | pg_policies/RLS有効をSELECT確認後、DROP IF EXISTS+CREATEで037を作り直し。検証SELECTを含むがスキーマ変更あり |
| 39 | `039_comprehensive_guest_access_fix.sql` | ゲスト向けanon SELECTを5テーブル一括付与 | 2025-11-13 | ✓ | 036,037,038 | ⚠️要確認 | ⚠️要確認 | custom_events/sessions/session_participants/scoring_prompts/participantsにDROP IF EXISTS+anon USING(true)。大会モードのゲスト閲覧用 |
| 40 | `040_fix_subscriptions_rls_for_pricing.sql` | subscriptions SELECTを組織メンバー基準に統一 | 2025-11-13 | ✓ | Users can view their own subscriptions / Authenticated users can view subscriptions | ⚠️要確認 | ⚠️要確認 | 旧SELECTポリシー3種をDROP IF EXISTSし、organization_members or user_id=auth.uid()の1本に集約。pricingページ表示用 |
| 41 | `041_add_guest_support_to_training_scores.sql` | training_scoresにゲスト対応列/制約追加 | 2025-11-13 | ⚠️注意 |  | ⚠️要確認 | ⚠️要確認 | **破壊変更** judge_id NOT NULL解除、guest_identifier追加、CHECK制約、unique_training_score制約をDROPし部分unique index化。ADD CONSTRAINT/CREATE UNIQUE INDEXは無ガードで再実行不可。042が後続 |
| 42 | `042_update_training_scores_rls_for_guests.sql` | training_scores RLSをゲスト対応に更新 | 2025-11-13 | ✓ | Judges can view/insert/update their own scores | ⚠️要確認 | ⚠️要確認 | **破壊変更** 041(guest_identifier列)が前提。検定員own系ポリシーをDROP IF EXISTSし、auth=セッション範囲/anon=guest_identifier基準を作成(RLS基準変更)。末尾に確認SELECTあり |
| 43 | `043_add_invite_code_to_organizations.sql` | 組織に招待コードinvite_codeを追加 | 2025-01-22 | ✓ |  | ⚠️要確認 | ⚠️要確認 | ADD COLUMN IF NOT EXISTS→生成関数/トリガ→最後にNOT NULL化。CREATE INDEX IF NOT EXISTS。043番が重複(anon policyと同番号) |
| 43 | `043_add_training_sessions_anon_policy.sql` | training_sessionsに匿名SELECTポリシー追加 | 2025-01-13 | ⚠️注意 |  | ⚠️要確認 | ⚠️要確認 | CREATE POLICYガードなしで再実行不可。匿名(anon)にtraining_sessions閲覧許可。043番が重複 |
| 44 | `044_add_performance_indexes.sql` | 20個のパフォーマンスインデックス追加 | 2025-11-16 | ✓ |  | ⚠️要確認 | ⚠️要確認 | 全てCREATE INDEX IF NOT EXISTS。10テーブル計20本。046と一部重複(idx_results_session_bib等) |
| 45 | `045_add_score_diff_control.sql` | sessionsに点差制限max_score_diff追加 | 2025-11-16 | ✓ |  | ⚠️要確認 | ⚠️要確認 | ADD COLUMN IF NOT EXISTS+CHECK制約(1〜10またはNULL)。DROP CONSTRAINT IF EXISTSで再適用可 |
| 46 | `046_add_performance_indexes.sql` | パフォーマンスインデックス4個追加 |  | ✓ |  | ⚠️要確認 | ⚠️要確認 | 作成日「2025年」のみで日付不明確。全てCREATE INDEX IF NOT EXISTS。044と一部重複(idx_results_session_bib/idx_training_scores_event_id) |
| 47 | `047_add_soft_delete_to_organization_members.sql` | organization_membersに論理削除を追加 |  | ⚠️注意 |  | ⚠️要確認 | ⚠️要確認 | **破壊変更** ヘッダ日付なし。ADD COLUMN(IF NOT EXISTSなし)removed_at/removed_by。viewポリシーを差替えRLS基準変更→このviewポリシーが無限再帰、051で修正 |
| 48 | `048_add_soft_delete_to_sessions.sql` | sessionsに論理削除deleted_atを追加 |  | ⚠️注意 |  | ⚠️要確認 | ⚠️要確認 | **破壊変更** ヘッダ日付なし。ADD COLUMN(IF NOT EXISTSなし)deleted_at/deleted_by。sessions SELECTポリシーを論理削除対応に差替えRLS基準変更 |
| 49 | `049_add_plans_table_with_retention.sql` | plansテーブルと保持期間を作成 | 2025-11-23 | ✓ |  | ⚠️要確認 | ⚠️要確認 | **アプリ先行** CREATE TABLE IF NOT EXISTS+ON CONFLICTでseed。050の前提。CREATE POLICY 2本は未ガード。organizations.plan_type参照を伴う運用 |
| 50 | `050_add_auto_delete_expired_archives.sql` | 期限切れアーカイブ自動削除関数を追加 | 2025-11-23 | ✓ |  | ⚠️要確認 | ⚠️要確認 | 関数定義(適用時はDELETE実行せず)。049とorganizations.plan_typeが前提。次手順でSupabase Cron設定が必要 |
| 51 | `051_fix_organization_members_rls_infinite_recursion.sql` | org_members RLS無限再帰を修正 | 2025-11-23 | ✓ | 047 (RLSポリシー) | ⚠️要確認 | ⚠️要確認 | **破壊変更** DROP POLICY IF EXISTS→再作成で再適用可。047の再帰ポリシーを「自分の所属/管理者閲覧」へ置換しRLS基準変更 |
| 52 | `052_fix_rls_with_security_definer.sql` | organization_members RLS無限再帰を修正 | 2025-11-23 | ⚠️注意 |  | ✅ | ✅ | is_organization_member/adminをSECURITY DEFINERで定義しSELECT/UPDATEを再構築。新規ポリシー名はDROP未保護で再実行は失敗 |
| 53 | `053_fix_subscriptions_unique_constraint.sql` | subscriptions UNIQUE制約を修正（顧客→サブスクID） | 2026-01-21 | ✓ |  | ⚠️要確認 | ⚠️要確認 | **破壊変更** stripe_customer_id UNIQUE削除→stripe_subscription_id/組織activeへ付替。DROP CONSTRAINT IF EXISTS等で冪等。制約削除=breaking |
| 54 | `054_merge_plans_into_plan_limits.sql` | plansをplan_limitsに統合しplans削除 | 2026-01-21 | ⚠️注意 | plans テーブル | ⚠️要確認 | ⚠️要確認 | **💥破壊的 破壊変更** archived_data_retention等を移行後 DROP TABLE plans。UPDATE...FROM plans のため一回限り(再実行不可)。テーブル削除=breaking |
| 55 | `055_add_create_organization_with_subscription_function.sql` | 組織作成のトランザクション関数を追加 | 2026-01-22 | ✓ |  | ⚠️要確認 | ⚠️要確認 | **アプリ先行** create_organization_with_subscription をCREATE OR REPLACEで定義。header:次工程で /api/organization/create を改修・デプロイ必要 |
| 56 | `056_make_create_organization_idempotent.sql` | 組織作成関数を冪等化 | 2026-01-22 | ✓ | 055 | ⚠️要確認 | ⚠️要確認 | 055のcreate_organization_with_subscriptionをCREATE OR REPLACEで置換。重複/再試行(UNIQUE違反)に安全な冪等版 |

### 3.2 ロックダウンera（1000–1021・21本）

> 注: 全ファイルが冪等・WHY/WHATヘッダ・DEV先行→prod の運用手順・ペアrollback付き。`1007`–`1021`＋`052` は dev+prod 適用確認済み。

| # | ファイル | 概要 | 日付 | 冪等 | 関連/supersedes | dev | prod | 備考 |
|---|---|---|---|:--:|---|:--:|:--:|---|
| 1000 | `1000_secure_guest_session_isolation.sql` | ゲストセッション隔離をJWTで実現(scores/results) | 2026-03-11 | ⚠️注意 | 999 | ⚠️要確認 | ⚠️要確認 | **アプリ先行 破壊変更** CRITICAL。999の脆弱ポリシーを置換、is_guest→JWT session_idへRLS基盤変更。サーバのsignInAnonymously発行が前提。SELECT作成はDROP未保護 |
| 1001 | `1001_harden_guest_rls_with_jwt_claims.sql` | anonのscores/resultsポリシーをJWT+照合で再作成 | 2026-03-11 | ✓ | 1000 | ⚠️要確認 | ⚠️要確認 | 1000のフォローアップ。anonポリシーを動的に全削除→session_participants+guest_identifier照合で再作成。越境/同一セッション内なりすまし防止 |
| 1002 | `1002_harden_session_participants_rls.sql` | session_participants の参加登録/更新RLS厳格化 | 2026-06-09 | ⚠️注意 | 031 INSERT/010 UPDATE policies | ⚠️要確認 | ⚠️要確認 | **アプリ先行 破壊変更** 堅牢性監査High#1。anon INSERT廃止=ゲスト登録はservice role経由が前提。031/010ポリシー置換。参加者injection/越境改名を封鎖 |
| 1004 | `1004_reconcile_session_participants_delete_rls.sql` | session_participants DELETEを正規1本に収束 | 2026-06-09 | ✓ | 1002 (legacy DELETE 名残) | ⚠️要確認 | ⚠️要確認 | IDOR解消。名前非依存で全DELETE削除→正規1本。can_manage_session_participants(bigint)追加。header:アプリ非依存で随時適用可 |
| 1005 | `1005_reconcile_session_participants_insert_rls.sql` | session_participants INSERTを正規1本に収束 | 2026-06-09 | ✓ | 1002 (名前不一致で未除去のレガシーINSERT) | ⚠️要確認 | ⚠️要確認 | **アプリ先行 破壊変更** INSERTポリシー全削除→authedが自分を非ゲストで追加のみ。ゲストINSERTはservice role化アプリ(36a7e37)デプロイ後に適用 |
| 1006 | `1006_enforce_org_member_limit_toctou.sql` | 組織メンバー上限をDBトリガーでアトミック強制 | 2026-06-09 | ✓ |  | ⚠️要確認 | ⚠️要確認 | BEFORE INSERTトリガで対象orgをFOR UPDATEロック→再カウントしTOCTOU解消。CREATE OR REPLACE+DROP TRIGGER IF EXISTS |
| 1007 | `1007_rls_lockdown_cross_session.sql` | results等4表の越境=trueポリシーをスコープ化 |  | ✓ |  | ✅ | ✅ | **DEV先行 破壊変更** 「DEVに先に適用」。anon=JWT(session_id)/authed=参加スコープへ統一。is_session_member無ければ作成。アプリ変更不要 |
| 1008 | `1008_sessions_anon_lockdown.sql` | sessions anon SELECTを自JWT session_idに限定 |  | ✓ |  | ✅ | ✅ | **DEV先行 アプリ先行 破壊変更** 「前提(順序厳守):アプリのservice-role化を先にデプロイ」「DEV先行」。過剰anon/public SELECT撤去でcode/token漏洩封鎖 |
| 1009 | `1009_results_owner_add.sql` | resultsにowner列(judge_id/guest_id)を追加(ADDITIVE) |  | ✓ |  | ✅ | ✅ | **DEV先行** 「DEV先行」。phase1=旧アプリ互換(新列nullable・旧name-unique維持)。FK/CHECK/部分一意索引追加+backfill。適用順:prod1009→新アプリ→1010 |
| 1010 | `1010_results_owner_enforce.sql` | results RLSをowner基準へ・旧name-unique撤去 |  | ✓ | 旧 name-based unique | ✅ | ✅ | **DEV先行 アプリ先行 破壊変更** 「前提:1009適用済かつownerを書く新アプリをデプロイ済」「DEV先行」。同名検定員の相互上書き根治。phase2 |
| 1011 | `1011_sessions_fk_owner_delete.sql` | sessionsのchief_judge_id/created_byをauth.users SET NULL FKに統一 |  | ✓ |  | ✅ | ✅ | **DEV先行** prod=CASCADE/dev=NO ACTIONをSET NULLへ統一。先にダングリング参照をNULL化。デプロイ順序制約なし。冪等 |
| 1012 | `1012_custom_events_rls_lockdown.sql` | custom_eventsの越境write/deleteとanon全読みを塞ぐRLS |  | ✓ | 029/037-039 over-broad policies | ✅ | ✅ | **DEV先行 破壊変更** 書込みをsession creator/chief/orgメンバーに、anon SELECTをJWT session_idに限定。authed SELECTは別バッチ。冪等 |
| 1013 | `1013_organizations_write_lockdown.sql` | organizationsのUPDATE/DELETEをorg adminに限定 |  | ✓ | 017 update_organization/delete_organization | ✅ | ✅ | **DEV先行 破壊変更** over-broad(=true)を撤去しis_organization_adminへ。SELECT/INSERTは別バッチ。アプリ変更なし。冪等 |
| 1014 | `1014_custom_events_select_lockdown.sql` | custom_eventsのauthed SELECTを参加者/orgメンバーに限定 |  | ✓ | 030 'Authenticated users can view custom events' | ✅ | ✅ | **DEV先行 破壊変更** over-broad(=true,030)を撤去。write/anonは1012で対応済。公開scoreboardはservice-roleで無影響。冪等 |
| 1015 | `1015_org_members_drop_overbroad_select.sql` | organization_membersの過剰SELECT(=true)を撤去 |  | ✓ | 016 select_all_memberships | ✅ | ✅ | **DEV先行 破壊変更** select_all_membershipsをdrop ifで撤去のみ。scoped SELECT(own/同一orgメンバー/admin)は既存・非再帰。冪等 |
| 1016 | `1016_organizations_select_lockdown.sql` | organizations の SELECT をメンバー限定化 |  | ✓ | 010/017 organizations 過剰SELECT | ✅ | ✅ | **DEV先行 アプリ先行 破壊変更** 前提:org参照のservice-role化アプリを先にデプロイ。010/017の過剰SELECT撤去。DEV先行→prod。冪等 |
| 1017 | `1017_profiles_select_scope.sql` | profiles SELECT を can_view_profile 化 |  | ✓ | Allow users to read all profiles | ✅ | ✅ | **DEV先行 破壊変更** DBのみ・アプリ無変更。同一session/org共有者のみ可視。emailは列保護対象外。DEV先行→prod。冪等 |
| 1018 | `1018_organizations_drop_authed_insert.sql` | organizations の過剰INSERT(=true)を撤去 |  | ✓ | authed INSERT(=true) policy | ✅ | ✅ | **DEV先行 破壊変更** org作成はservice-role経由のみに（当該ポリシーは未使用）。DBのみ。DEV先行→prod。冪等 |
| 1019 | `1019_organizations_admin_consolidate.sql` | organizations admin UPD/DEL を1013へ一本化 |  | ✓ | 020 inline admin UPDATE/DELETE | ✅ | ✅ | **DEV先行 破壊変更** 020由来のinline adminポリシー撤去（removed_at未チェック）。active adminは1013で可。DEV先行→prod。冪等 |
| 1020 | `1020_profiles_drop_email.sql` | profiles.email 列を削除（PII保護） |  | ✓ | profiles.email (auth.users.email冗長コピー) | ✅ | ✅ | **DEV先行 アプリ先行 💥破壊的 破壊変更** 前提:email参照全廃アプリを先にデプロイ。auth.users.emailへ一本化。列ごと削除でデータ喪失。DEV先行→prod。冪等 |
| 1021 | `1021_sessions_dedupe_own_policies.sql` | sessions の public own 重複ポリシー撤去 |  | ✓ |  | —(対象無/no-op) | ✅ | **DEV先行** 「DBのみ・冪等・DEV 先行→prod」。authed 等価版が残り挙動ゼロ変化。dev は対象なし no-op。末尾に検証SELECT |

## 4. ロールバック対応表（17本）

> rollback は通常運用では実行しない（緊急時のみ）。`database/migrations/rollbacks/` に格納。複数適用済みの場合は**番号の大きい方から**戻す（各 rollback ヘッダの指示に従う）。

| rollback ファイル | 取り消す対象 | 冪等 | 備考 |
|---|---|:--:|---|
| `001_add_tournament_mode_rollback.sql` | `001_add_tournament_mode.sql` | ✓ | **💥破壊的 破壊変更** 001_add_tournament_modeを取り消し。custom_events/participantsをCASCADE削除しデータ消失。列/制約もDROP |
| `004_add_training_mode_rollback.sql` | `004_add_training_mode.sql` | ✓ | **💥破壊的 破壊変更** 004_add_training_modeを取り消し。training_*をCASCADE削除しmode列/制約もDROP。データ消失 |
| `1007_rollback_rls_lockdown.sql` | `1007_rls_lockdown_cross_session.sql` | ✓ | **破壊変更** 「緊急時のみ」。越境読書きの穴を元に戻す。is_session_member関数は残す。冪等 |
| `1008_rollback_sessions_anon_lockdown.sql` | `1008_sessions_anon_lockdown.sql` | ✓ | **破壊変更** 「緊急時のみ」。join_code/invite_token漏洩を復活。anon_sessions_select_by_jwtを撤去。冪等 |
| `1009_rollback.sql` | `1009_results_owner_add.sql` | ✓ | **💥破壊的 破壊変更** 列DROPでbackfill値喪失。1010適用済なら先に1010_rollback.sqlを実行。冪等 |
| `1010_rollback.sql` | `1010_results_owner_enforce.sql` | ✓ | **破壊変更** owner列/部分一意索引(1009)は残す。旧name-based UNIQUEは再追加しない(同名別owner行で失敗回避)。冪等 |
| `1011_rollback.sql` | `1011_sessions_fk_owner_delete.sql` | ✓ | created_byをauth.users ON DELETE CASCADEへ復帰。データ変更（ダングリング→NULL）は戻せない（無害）。冪等 |
| `1012_rollback.sql` | `1012_custom_events_rls_lockdown.sql` | ✓ | ⚠️復帰でcustom_eventsの越境write/delete・anon全読みが再開。helper is_organization_memberは残す。緊急時のみ。冪等 |
| `1013_rollback.sql` | `1013_organizations_write_lockdown.sql` | ✓ | ⚠️復帰で任意の認証ユーザーが任意組織を改変/削除可。helper is_organization_adminは残す。緊急時のみ。冪等 |
| `1014_rollback.sql` | `1014_custom_events_select_lockdown.sql` | ✓ | ⚠️復帰で全org/全session種目を越境閲覧可。緊急時のみ。冪等 |
| `1015_rollback.sql` | `1015_org_members_drop_overbroad_select.sql` | ✓ | ⚠️復帰で任意の認証ユーザーが全組織の所属を越境列挙可。drop if exists後にcreate。緊急時のみ。冪等 |
| `1016_rollback.sql` | `1016_organizations_select_lockdown.sql` | ✓ | 緊急時のみ。復帰で全組織が越境閲覧可に戻る。冪等 |
| `1017_rollback.sql` | `1017_profiles_select_scope.sql` | ✓ | 緊急時のみ。helper can_view_profileは残す（無害）。冪等 |
| `1018_rollback.sql` | `1018_organizations_drop_authed_insert.sql` | ✓ | 緊急時のみ。authedクライアントのorg作成を一時許可。冪等 |
| `1019_rollback.sql` | `1019_organizations_admin_consolidate.sql` | ✓ | 緊急時のみ。soft-removed adminが改変/削除できる緩い状態へ。1013は触らない。冪等 |
| `1020_rollback.sql` | `1020_profiles_drop_email.sql` | ✓ | 緊急時のみ。auth.users.emailからbackfill。冪等 |
| `1021_rollback.sql` | `1021_sessions_dedupe_own_policies.sql` | ✓ | 1021 の rollback。緊急時のみ。drop if exists→create で冪等。通常は authed 版が own を担保するため不要 |

## 5. 非マイグレーション（検証/診断 4本・破壊的データ削除 2本）

> これらは前進スキーマ変更ではない。検証系4本は `database/migrations/verify/`、破壊的データ削除2本（`008`/`010`）は `database/migrations/archive/one-time/` へ隔離済み。

| ファイル | 種別 | 内容 |
|---|---|---|
| `004_verify_training_mode.sql` | 検証SELECT | 研修モード適用の検証SELECT。mode列/テーブル/RLS/索引/トリガー/制約をSELECTで確認するのみ。スキーマ変更なし |
| `999_check_user_data.sql` | 検証SELECT | ログインユーザーの既存データ確認クエリ。SELECT のみ。クリーンアップ用 DELETE/TRUNCATE は全てコメントアウト。スキーマ変更なし |
| `check_production_schema.sql` | 検証SELECT | 本番スキーマ(列/FK)確認用 SELECT。information_schema 等を SELECT するのみ。本番 SQL Editor で実行。スキーマ変更なし |
| `verify_migration.sql` | 検証SELECT | Tournament Mode 移行の検証 SELECT。列/テーブル/RLS/index/trigger/制約の存在を SELECT 確認。スキーマ変更なし |
| `archive/one-time/008_phase0_cleanup_existing_data.sql` | 💥破壊的データ削除 | 既存データを全TRUNCATEしクリーンアップ。ヘッダ「本番未稼働のため削除して再構築」。Phase0、009(Phase1)の前に実行。全テーブルTRUNCATE。**隔離済み** |
| `archive/one-time/010_cleanup_existing_user_data.sql` | 💥破壊的データ削除 | 既存組織・セッションデータをTRUNCATE。日付なし。profiles/auth.usersは保持。末尾に確認SELECT。**隔離済み** |

## 6. 適用状況の確認クエリ（prod / dev 双方の SQL Editor で実行 → 本台帳を実測値に更新）

> ⚠️ いずれも **読み取り専用**。`prod` と `dev` の両方で流して結果を比較し、`⚠️要確認` を `✅`/`🔴` に置き換える。

```sql
-- (A) 001 が適用済みか（sessions のロック列の有無）
SELECT column_name FROM information_schema.columns
WHERE table_schema='public' AND table_name='sessions'
  AND column_name IN ('failed_join_attempts','is_locked');
-- 0行なら 001_add_session_security.sql は未適用。

-- (B) 現行 RLS ポリシーのスナップショット（prod/dev 差分照合用）
SELECT tablename, policyname, cmd, roles, qual, with_check
FROM pg_policies WHERE schemaname='public'
ORDER BY tablename, policyname;

-- (C) 任意テーブル/列の存在チェック（マイグレーション到達確認の汎用形）
SELECT table_name, column_name FROM information_schema.columns
WHERE table_schema='public'
  AND table_name IN ('results','profiles','organizations','session_participants')
ORDER BY table_name, ordinal_position;
-- 例: results.owner(1009/1010)、profiles に email が無い(1020) 等で適用を判定。
```

---

## 付録: 集計

- 総ファイル: **106**（forward 81 ／ rollback 17 ／ verify·診断 4 ／ cleanup 2 ／ deprecated 1 ／ planned 1）
- dev+prod 適用確認済み: **16**（1007–1021 ＋ 052）
- 適用状況 要確認: forward のうち上記・実行禁止・prod未適用疑いを除く残り

> 本台帳の値は「ヘッダ抽出＋運用ログ(`tasks/todo.md`)＋監査メモ(`memory/prod-schema-rls-drift.md`)」由来。確証の無い適用状況は誇張せず `⚠️要確認` とした。§6 で実測して更新すること。
