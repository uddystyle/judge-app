# ⚠️ アーカイブ注記: 2025-12 RLS パフォーマンス最適化（放棄トラック）

> このディレクトリは元はリポジトリ直下の `migrations/` にあった**放棄された実験トラック**です。
> `database/migrations/` の本流とは別物で、番号（001–005）が本流と概念衝突します。
> **ここの SQL は本流の適用順とは無関係**であり、原則として実行しないでください。
> （隣の `README.md` / `STEP_BY_STEP_GUIDE.md` / `OPTIMIZATION_GUIDE.md` は当時のままの作業メモです。）

## 経緯
- 追加コミット `3607dd5`（タイトル "temporary"、2025-12-01）。以後ほぼ未更新。
- 目的: RLS の `auth.uid()` → `(SELECT auth.uid())` initplan 最適化と重複インデックス削除の検討。

## 適用状況（重要）
- ✅ **`get_current_user_id()`（`005_step1_helper_functions.sql`）だけは prod/dev に適用済みで、現在も生存依存**。本流 `database/migrations/1021_sessions_dedupe_own_policies.sql` がこの関数に依存している。**この関数定義は削除しないこと。**
- ❌ `(SELECT auth.uid())` への書き換え（`005_step2`〜`005_step6` 等）は**本番未採用**。
- その他（`001_remove_duplicate_indexes` 等）も未採用。

## 方針
- 履歴保存目的で残置。新たな最適化は、ここの番号を流用せず `database/migrations/` に新規番号で起こすこと。
- 適用順・適用状況の唯一の真実は [`../../migrations/APPLIED.md`](../../migrations/APPLIED.md)。
