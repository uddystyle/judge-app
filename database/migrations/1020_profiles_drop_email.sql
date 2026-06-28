-- ============================================================================
-- Migration 1020: profiles.email 列を削除（PII 列保護・auth.users.email へ一本化）
-- ============================================================================
-- WHY: 1017 で profiles SELECT を行スコープ化したが、行は session/org 共有者に可視で
--      **email 列も読めてしまう**（直 PostgREST で同 session/org メンバーの email 取得可・PII）。
--      RLS は列単位にできない。profiles.email は auth.users.email の冗長コピーで、アプリの
--      email 参照は全廃済み（auth セッションの user.email を使用）。よって列ごと削除する。
-- 安全性（確認済み）: signup トリガー handle_new_user は `INSERT INTO profiles (id, full_name)` のみで
--      email を入れていない（prod/dev 確認済）。profiles の RLS/関数も email を参照しない。
-- ⚠️ 前提: アプリ（email 参照全廃＝insert 3箇所・Stripe 2箇所）を**先にデプロイ済み**であること。
--      逆順だと旧アプリの insert(email) が落ちる。
-- DBのみ・冪等。DEV 先行 → prod。問題時は 1020_rollback.sql。
-- ============================================================================

-- RESTRICT 既定: もし policy/view/関数が email に依存していれば失敗して気付ける。
alter table public.profiles drop column if exists email;

-- 検証（email 列が無いこと）
select column_name
from information_schema.columns
where table_schema = 'public' and table_name = 'profiles'
order by ordinal_position;
