# アーカイブ（陳腐化・時点記録ドキュメント）

ルート直下に蓄積していた**時点記録（point-in-time）／後続に置き換えられた**ドキュメント群。
履歴保存のために残置。現行の正は各分野フォルダ（[`../security/`](../security/)、[`../realtime/`](../realtime/) 等）と [`../README.md`](../README.md) を参照。

未解決の課題は埋もれないよう [`../security/known-issues.md`](../security/known-issues.md) に救出済み。

## 主な内容
- **セキュリティ分析 2波**: 2025-11（英語）/ 2026-03（日本語）の found→fixed→verified 連鎖。`=true` RLS 穴は migration 1007–1021 で解消済み（[`../../database/migrations/APPLIED.md`](../../database/migrations/APPLIED.md) 参照）。
- **時点修正メモ**: CSP（`CSP_*_FIX`、現行は [`../security/csp.md`](../security/csp.md)）、`RATE_LIMIT_*`、`EXCESSIVE_LOGGING_FIX`、`REMOVED_AT_FILTER_FIX`、`REALTIME_*_ENHANCEMENTS/TEST_SUMMARY`、`*_BOTTLENECK_ANALYSIS`、`TEST_IMPLEMENTATION_SUMMARY`、`SUBSCRIPTION-AUDIT-REPORT`。
- **旧設計・索引**: `Plan.md`/`Plan2.md`/`Plan3.md`（組織ベース設計が現行実装に反映済み）、`README_ANALYSIS.md`、`QUICK_REFERENCE.md`、`START_HERE.md`。
