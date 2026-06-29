# 既知の未解決課題（prod / dev）

> ルート直下にあったセキュリティ分析レポート群（2025-11 / 2026-03 の2波）を `docs/archive/` へアーカイブする前に、**まだ解決していない事項だけ**をここへ救出したもの。
> 出典: 監査 `database/diagnostics/audit_schema_rls.sql` / `audit_rls_overbroad.sql` の prod+dev 突合、運用ログ `tasks/todo.md`、適用台帳 [`../../database/migrations/APPLIED.md`](../../database/migrations/APPLIED.md)。
> 最終整理: 2026-06-29。

## ✅ 解消済み（背景・再オープン防止のため記録）

機微テーブルの `=true` 越境 read/write/delete 穴は **migration 1007–1021 で一掃済み（監査クエリ 0 件、prod+dev 適用済み）**:
`results`（1009/1010 owner 基準）、`sessions` anon SELECT（1008 で JWT session_id 限定）、`custom_events`（1012/1014）、`organizations`（1013/1016/1018/1019）、`organization_members`（1015）、`profiles`（1017、さらに 1020 で email 列削除＝PII閉鎖）、`session_participants`（1007）。

## 🔴 要対応

> 現在オープンな 🔴 課題はありません。

> ~~`001_add_session_security` prod 未適用の疑い~~ → **2026-06-29 実測で否定済み**。dev・prod とも `sessions.failed_join_attempts` / `is_locked` の存在を確認（`001_add_session_security.sql` は両環境適用済み・参加コード join の500懸念は無し）。

## 🟡 ドリフト（環境差・慎重対応）

### 2. `results.id` の主キー型が環境で異なる
- **prod = bigint / dev = uuid**。`results_event_id_fkey` は旧 `events` テーブル参照。
- 影響: id 型を前提にするコード/将来マイグレーションは両環境で挙動が割れる。新規 migration を書く際は型差を必ず考慮。
- 対応方針: 恒久対応は要設計（どちらかに寄せる移行＝データ移行を伴う）。当面は「型差あり」を前提に開発。

### 3. `sessions` の重複ポリシーが prod/dev ドリフトで未撤去
- `1021` で prod の public ロール own 重複（DELETE/UPDATE）は撤去済み。**残: INSERT `Users can create sessions` / SELECT `Users can view active sessions...` の重複**。
- dev は prod 相当（`Allow authenticated users to create sessions` / `Allow participants to read their sessions`）を持たないため、単純撤去すると dev で唯一の own-insert / participant-read を失う。
- 対応方針: 「dev 整合」（dev に prod 相当ポリシーを追加）→ 両環境で重複撤去、の順。任意・要慎重。

### 4. `results` の UNIQUE 制約名がドリフト
- prod = `results_unique_score_entry` + `unique_result_per_judge` / dev = `results_unique_score` + `unique_result_per_judge`（名前差・二重定義）。
- 注: `1010` で旧 name-based unique は撤去方針のため、適用後の現状は [`APPLIED.md` §6 クエリ(B)](../../database/migrations/APPLIED.md) で要再確認。

## 確認できた非問題（誤検知防止のため記録）
- `training_events` の anon SELECT `USING true`（両環境）はゲスト研修採点に必要 → 問題ではない。
- `training_scores.judge_id` は uuid（両環境）＋部分一意索引あり → 整合。
- `sessions.created_by` FK は `1011` で prod/dev とも `auth.users ON DELETE SET NULL` に統一済み（旧 prod=CASCADE/dev=NO ACTION のドリフトは解消）。
