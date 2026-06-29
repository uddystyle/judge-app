# ドキュメント索引

TENTO（SvelteKit + Supabase + Stripe・組織ベース採点アプリ）の技術ドキュメント一覧。
ルート直下に散在していた資料を分野別に整理したもの（整理プラン Phase 1）。

## セキュリティ — [`security/`](./security/)

| ドキュメント | 内容 |
|---|---|
| [SECURITY_CHECKLIST.md](./security/SECURITY_CHECKLIST.md) | デプロイ前セキュリティ確認チェックリスト |
| [SECURITY_KEY_ROTATION.md](./security/SECURITY_KEY_ROTATION.md) | APIキー・シークレットのローテーション手順 |
| [SECURITY_TEST_PLAN.md](./security/SECURITY_TEST_PLAN.md) | セキュリティテスト計画 |
| [GUEST_SESSION_SECURITY.md](./security/GUEST_SESSION_SECURITY.md) | ゲストセッション分離の設計 |
| [csp.md](./security/csp.md) | Content-Security-Policy 実装（SvelteKit 自動 nonce） |

## リアルタイム — [`realtime/`](./realtime/)

| ドキュメント | 内容 |
|---|---|
| [REALTIME_SETUP.md](./realtime/REALTIME_SETUP.md) | Supabase Realtime セットアップ手順 |
| [REALTIME_SECURITY.md](./realtime/REALTIME_SECURITY.md) | Realtime の RLS セキュリティガイド |

## 決済 / Stripe — [`stripe/`](./stripe/)

| ドキュメント | 内容 |
|---|---|
| [STRIPE_SETUP.md](./stripe/STRIPE_SETUP.md) | Stripe 初期セットアップ |
| [stripe-cli-setup.md](./stripe/stripe-cli-setup.md) | Stripe CLI セットアップ・E2E 手順 |
| [stripe-products-setup.md](./stripe/stripe-products-setup.md) | 商品・価格の作成 |
| [stripe-test-strategy.md](./stripe/stripe-test-strategy.md) | 決済テスト戦略 |
| [STRIPE_PRICING_UPDATE_GUIDE.md](./stripe/STRIPE_PRICING_UPDATE_GUIDE.md) | 料金体系の更新手順 |
| [STRIPE_PRODUCTION_MIGRATION.md](./stripe/STRIPE_PRODUCTION_MIGRATION.md) | 本番環境への移行手順 |

## アーキテクチャ / 機能設計 — [`architecture/`](./architecture/)

| ドキュメント | 内容 |
|---|---|
| [SESSION_MODES_ANALYSIS.md](./architecture/SESSION_MODES_ANALYSIS.md) | 3 つのセッションモード完全分析（最新・最広） |
| [COMPETITION_MODE_ANALYSIS.md](./architecture/COMPETITION_MODE_ANALYSIS.md) | 大会モードの分析 |
| [TRAINING_MODE_IMPLEMENTATION_GUIDE.md](./architecture/TRAINING_MODE_IMPLEMENTATION_GUIDE.md) | 研修モード実装ガイド |
| [SCORE_CONTROL_ROADMAP.md](./architecture/SCORE_CONTROL_ROADMAP.md) | 点数制御機能のロードマップ |

## パフォーマンス — [`performance/`](./performance/)

| ドキュメント | 内容 |
|---|---|
| [PERFORMANCE_OPTIMIZATION.md](./performance/PERFORMANCE_OPTIMIZATION.md) | パフォーマンス最適化の手引き（インデックス等） |

## テスト — [`testing/`](./testing/)

| ドキュメント | 内容 |
|---|---|
| [TESTING_GUIDE.md](./testing/TESTING_GUIDE.md) | テスト全般のガイド |
| [VERIFICATION_CHECKLIST.md](./testing/VERIFICATION_CHECKLIST.md) | 動作確認チェックリスト |

## バグ修正記録 — [`bugfixes/`](./bugfixes/)

`previousPromptId` / realtime / retry timer / サブスクリプションダウングレード等の修正記録。

## その他（既存）

| ドキュメント | 内容 |
|---|---|
| [guest-user-specification.md](./guest-user-specification.md) | ゲストユーザー仕様 |
| [training-mode-guest-user-roadmap.md](./training-mode-guest-user-roadmap.md) | 研修モード×ゲストのロードマップ |
| [soft-delete-implementation-plan.md](./soft-delete-implementation-plan.md) | 論理削除の実装計画 |
| [setup-archive-auto-deletion.md](./setup-archive-auto-deletion.md) | アーカイブ自動削除のセットアップ |
| [RESEND_SETUP.md](./RESEND_SETUP.md) | Resend（メール送信）セットアップ |

## 関連（docs 外）

- データベースのマイグレーション適用台帳: [`../database/migrations/APPLIED.md`](../database/migrations/APPLIED.md)
- 診断・監査用 SQL: [`../database/diagnostics/`](../database/diagnostics/)
