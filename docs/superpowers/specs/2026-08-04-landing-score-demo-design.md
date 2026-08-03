# ランディングページ 採点画面デモ（LandingScoreDemo）設計

日付: 2026-08-04
ステータス: 承認済み（ブレスト経て確定）

## 目的

LP（`src/routes/+page.svelte`）は現状すべてテキストで、製品ビジュアルが一切無い。
TENTO の中核である「採点画面」をヒーローに見せ、訪問直後に「何をするサービスか」を
直感的に伝える。

## 確定した方針（ブレスト）

- 見せ方: **自動再生アニメ**（訪問者が触れなくても採点の流れが伝わる。`prefers-reduced-motion` では静止）
- 配置: **ヒーローに組み込む**（above the fold。現状テキストのみで余白が大きいヒーローを埋める）
- 枠: **スマホモック枠の中**（検定員は会場でスマホ採点する前提。「モバイル対応」訴求と一致）

## コンポーネント設計（分離）

新規 `src/lib/components/LandingScoreDemo.svelte` — **純・表示用**。実際の
`ScoreInput`/`NumericKeypad` は再利用せず見た目だけ忠実に複製する（採点ロジック・
dispatch・検証・AlertDialog・loading は持たない）。理由: LP を採点の内部実装から
切り離し、自動再生に最適化するため。

- パレットは本物と同じトークンを使い見た目を一致させる: `--accent-primary`（得点数字）、
  `--bg-primary`、`--border-light`、`--text-primary`、`--text-secondary`。
- 構成: スマホ枠（角丸＋上部に細いステータスバー風の帯）→ 案内文（`m.score_enterScore()`
  =「採点してください」を再利用・localized）→ 大きな得点数字（アクセント色）→
  テンキー（7 8 9 / 4 5 6 / 1 2 3 / C 0 確定 の 3×4 グリッド。実画面の配列に準拠）。

## アニメ挙動

- 小さな JS タイマー駆動の状態機械（component ローカル）。約5秒ループ:
  1. 得点を1桁ずつ表示（例: 空→"8"→"88"）、対応する数字キーを一瞬ハイライト
  2. 「確定」キーがハイライト → 得点数字がポンと弾む＋一瞬チェック表示
  3. 数百 ms 間を置いてリセット、次の得点へ（`[88, 92, 76, 85]` を巡回）
- `onDestroy` でタイマー解除。`IntersectionObserver` でビューポート内の時だけ再生
  （画面外では停止、軽量化）。SSR ガード（`typeof window`）。
- **`prefers-reduced-motion: reduce` ではアニメを完全停止し、数字が入った静止状態（例 "88"）**
  を表示。`matchMedia` を購読し、実行中の切替にも追従。

## レイアウト（ヒーロー2カラム化）

- `src/routes/+page.svelte` のヒーローを編集:
  - PC（≥768px）: 2カラム。左＝見出し/サブ/説明/CTA（**左寄せに変更**）、右＝
    `LandingScoreDemo`。ヒーロー幅を 800px→~1100px に拡張、`gap` を確保、`align-items: center`。
  - モバイル: 縦積み。中央寄せのまま、CTA の下にデモ（スマホは一回り小さく）。
- 既存の他セクション（features / how-it-works / pricing / cta）は変更しない。

## i18n

- キャプション用に `landing_scoreDemoCaption`（例: 「実際の採点画面」）を
  `messages/ja.json` と `messages/en.json` に追加（paraglide がビルド時にコンパイル）。
- 案内文は既存 `score_enterScore` を再利用（新規キー不要）。

## 検証

- 表示専用のため重いテストは不要。`prefers-reduced-motion` 分岐と、
  巡回得点配列の桁組み立てロジック（もし純関数に切り出すなら）をスモークテスト。
- svelte-check 0 / build 成功 / 変更ファイル prettier・eslint クリーンを維持。
- ヒーロー2カラム化がモバイル/PC で崩れないこと（レスポンシブ確認）。

## 非目標（YAGNI）

- 実採点コンポーネントの再利用・共通化はしない（意図的に複製）。
- 触れるインタラクション・送信は無し（自動再生のみ）。
- モード切替（大会/研修）の複数デモは作らない（検定 0-99 の1種で十分）。
