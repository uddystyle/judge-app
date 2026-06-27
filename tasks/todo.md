# Current Tasks

## Active

### 堅牢性監査 — High重大度の修正（feature ブランチ）— ✅ 完了

- [x] **#6** `restartSession` の `?guest=任意文字` バイパス → `session/[id]/+page.server.ts:509-515`：`authResult.guestParticipant` で判定
- [x] **#1a** `updateGuestName` に認可追加（IDOR）→ `authenticateAction` + JWT検証済み自分の `guest_identifier` のみ更新
- [x] **#1b** `session_participants` RLS開放是正 → 新マイグレ `1002_harden_session_participants_rls.sql` + ゲストINSERTを `supabaseAdmin` へ（`session/join`・`session/invite/[token]`）
- [x] **#2** `changePlan` 管理者チェック欠落 → Stripe呼び出し前に admin判定（`removed_at` null付き）
- [x] **#3** Stripe Webhook Basil非互換 → `getSubscriptionPeriod`/`getInvoiceSubscriptionId` ヘルパー + イベント由来5箇所修正
- [x] **#5(limits-1)** ゲスト参加が検定員上限を回避 → `session/join`：`if(!isGuestMode)` ガード除去
- [x] **#5(limits-2)** メンバー上限が受諾時未強制 → 3経路で `checkCanAddMember`
- [x] **#4** アカウント削除の孤児化（削除をブロック）→ `api/delete-user`：唯一管理者の有料組織で409、個人サブスク解約後に削除 + UI文言整合

## レビュー（2026-06-09）
- 型チェック: `npm run check` → 既存306エラーのまま（**自分の変更で新規エラー0件**、stash比較で確認）。残存は既存の Stripe Basil 型 vs acacia ランタイム等。
- テスト: `npx vitest run src/` → **662 passed (38 files)**。
  - `session/join`・`session/invite` のアクションテストは `locals.supabaseAdmin` を追加して実態に整合。
  - `invite/[token]/complete` に上限ブロックの新規テストを追加（403で挿入されないこと）。
- ⚠️ **要デプロイ作業**: RLSマイグレ `1002_harden_session_participants_rls.sql` を本番Supabaseへ適用必須（このリポジトリからは適用不可）。適用前はDBレベルのIDOR（#1b）が残るため、ステージング検証→本番適用を推奨。
- ⚠️ **#3 要確認**: Stripeダッシュボードの webhook エンドポイントAPIバージョン。コードは両形状対応にしたが、Basil形状の実イベントでの疎通確認を推奨。

### 監査 — クイックウィン（Medium/Low）— ✅ 完了（2026-06-09）
- [x] **guest-join-6** 参加コード入力 `maxlength` 6→8（`session/join/+page.svelte`）
- [x] **guest-join-3** ゲスト名を `validateName` でサニタイズ（`session/join`・`session/invite/[token]`、INSERT＋JWTメタデータ両方）
- [x] **signup-1** 既存ユーザーも新規と同一応答（303 → /signup/success）に統一（列挙対策）。`signup.test.ts` も更新
- [x] **authz-model-1** `removed_at IS NULL` を残り4箇所の admin判定に追加（change-plan load/cancelSubscription、organization/[id]/delete load/action）
- [x] **ratelimit-4** Stripeオブジェクト生成系4エンドポイントを `api`→`expensive`（checkout/portal/customer-portal/upgrade）

レビュー: `npx vitest run src/` → **662 passed**。`npm run check` → 既存306のまま（新規エラー0）。アプリ層のみ（DBマイグレ不要）。
注記: `signup/+page.svelte` の `{#if form?.success}` は応答統一で未到達（無害・任意で除去可）。

### 監査 — レート制限クラスタ #2（login-hooks-1 / ratelimit-5）— ✅ 完了（2026-06-09）
- [x] ログインをクライアント側 `signInWithPassword` から**サーバー form action**へ移行し `checkRateLimit(auth)` を適用（signup/reset と同パターン）
  - `login/+page.server.ts`：`actions.default`（レート制限→正規化→signInWithPassword→成功時 `redirect(303, 検証済みnext)`、エラーは fail で i18n メッセージ）
  - `login/+page.svelte`：`<form method=POST use:enhance>` + hidden `next`、クライアント側 signIn と onMount 認証チェックを削除（load がSSRでリダイレクト）
  - `login.test.ts`：サーバーアクションの新規テスト8件（レート制限優先・正規化・各エラーコード・オープンリダイレクト・303）
- 事前調査（workflow）で確認: Cookie互換OK（同一 `sb-<ref>-auth-token` 形式）、Vercel `getClientAddress()` は raw XFF で詐称可能（XFF修正は別途 ratelimit-1）。
- レビュー: `npx vitest run src/` → **670 passed**。`npm run check` → 306（新規0）。
- ⚠️ **要・実地スモークテスト**: 認証フロー変更のためユニットテストだけでは Cookie/セッションのE2Eを保証できない。デプロイ前に「実ログイン→/dashboard到達→ハードリロードで維持」を確認すること。
- 未実装（#2の残り・未選択）: ratelimit-2(userIdキー), ratelimit-3(fail-closed)。

### 監査 — レート制限クラスタ #2b（ratelimit-1 / login-hooks-2）— ✅ 完了（2026-06-09）
- [x] `getClientIdentifier` のIP導出を「x-real-ip 優先 → x-forwarded-for 右端ホップ」に変更（左端=クライアント詐称可能を使わない）。`rateLimit.ts` のみ・呼び出し20箇所は無変更
- [x] `rateLimit.test.ts` 新規6件（user:id優先、x-real-ip優先、右端ホップ、左端偽値でバイパス不可、単一ホップ、unknown）
- レビュー: `npx vitest run src/` → **676 passed**。`npm run check` → 306（新規0）。アプリ層のみ・低リスク。

### 監査 — 決済の堅牢性 #3 — ✅ 完了（2026-06-09）
- [x] **stripe-webhook-4** subscription/created・updated でマッピング行が未作成（順序レース）の場合、`NonRetryableError(400)`→`RetryableError(500)` に変更。Stripeが再送し恒久ドロップを回避（`webhook/+server.ts`）。テスト1件を新挙動(500)に更新
- [x] **limits-4** `handleSubscriptionUpdated`：非課金ステータス（unpaid/canceled 等）では org を free 制限に降格。past_due は猶予として現プラン維持。`getOrganizationPlanLimits` は org.plan_type 参照のまま（RLS安全）
- [x] **limits-3** organization_members の上限を **DBトリガー**でアトミック強制（新マイグレ `1006_*`、org行を FOR UPDATE ロック→再カウント→超過は例外）。アプリ層 checkCanAddMember は維持（通常時メッセージ用）
- レビュー: `npx vitest run src/` → **676 passed**（webhook/limits テスト更新含む）。`npm run check` → 306（新規0）。
- ⚠️ **要デプロイ**: webhook-4 / limits-4 はアプリ層（feature→main→デプロイ）。**1006 トリガーは本番/開発DBへ手動適用が必要**（アプリ無変更でも安全に先行適用可）。
- 残（follow-up）: 検定員(session_participants)の TOCTOU トリガーは未対応（cap算出がアプリ logic と乖離しやすく要慎重・影響小）。stripe-webhook の retrieve由来の current_period_* 型エラーは既存（acacia ランタイムでは安全）。

### 監査 — 優先順クリーン修正（グループ1〜3, 7件）— ✅ 完了（2026-06-10・未コミット）
- [x] **guest-core-4** 大会スコアの judge_name を素の guest_name で保存（`addGuestSuffix` 除去）→ RLS(1000/1001)拒否＝保存不可の可用性バグ解消（`input/+page.server.ts`）
- [x] **guest-core-3** スコア保存に生の `?guest=` でなく JWT検証済み `guestParticipant.guest_identifier` を使用（同セッションのスコア偽造をアプリ側で防止）
- [x] **account-2** パスワード変更に現PWでの再認証を必須化＋成功時 global signOut（セッション奪取での乗っ取り固定化を防止、`account/+page.svelte`）
- [x] **login-hooks-3** `hooks.server.ts` の no-store に `/api/` 追加（`/api/me` 等のPIIキャッシュ防止）
- [x] **callback-1** `auth/callback` に `checkRateLimit(auth)` 追加（唯一未保護の認証経路）
- [x] **account-3** プロフィール名にクライアント検証（trim・100字上限）＋ input maxlength=100
- [x] **stripe-webhook-6** livemode不一致を error ログ化＋危険方向（テスト鍵に本番イベント）は503で可視化（テスト1件を新挙動に更新）
- レビュー: `npx vitest run src/` → **676 passed**。`npm run check` → 306（新規0。input等の `user possibly null` は既存・行ずれ表示）。
- 注: account-2/3 はクライアント側。account-3 の完全な保証はDB CHECK制約（任意マイグレ）。

## グループ4の判断結果（2026-06-10）
- **ratelimit-2** → **見送り（C）**。ratelimit-1(XFF信頼IP化)済みでIPベースが堅牢になり、getUser再順序のトレードオフ＋15ファイル変更に見合わないため。
- **広いSELECT（session_participants）** → **据え置き（既知Low）**。調査(workflow)結果＝「絞り込みは可能だが前提あり」:
  - 公開スコアボードは session_participants を読まない（最大懸念はクリア）。リアルタイムも無関係。
  - ただし **bare-anon(JWTなし)読み取りが3つ**: ①`checkCanAddJudgeToSession`(organizationLimits.ts:243) がゲスト参加で signIn前に anon 実行→絞ると検定員上限が静かにバイパス（要 supabaseAdmin 化）、②`session/[id]:30` 旧`?guest=`移行パス、③`api/score-status:23` レガシー。
  - **本番限定の未確認2点**: `is_session_member()` 定義（ソース管理外）、ゲストが results/training_scores でどのロール実行か（1000/1001は `TO anon`、これが壊れると採点リグレッション）。
  - 結論: 採点フローへのリグレッションリスク＋本番検証必須 vs 低機微PII(ゲスト名＋参加関係)のため据え置き。再開する場合の段階案は会話ログ参照（Stage1=カウントをsupabaseAdmin化、Stage2=scoped SELECTマイグレ＋本番2クエリ検証）。

## 未着手で残っている項目
- **ratelimit-3**（fail-closed・可用性トレードオフ＋監視(Sentry等)未配線）— 未相談
- **検定員TOCTOU**（session_participants 検定員上限の原子化。cap算出がアプリlogicと乖離しやすく要慎重・影響小）
- **広いSELECT**（上記・据え置き）

## 中断時点のブランチ/デプロイ状態（2026-06-10）
- `main`（本番デプロイ対象）: High6件 + session_participants RLS(1002/1004/1005) + クイックウィン + ログインサーバ化 + XFF + 決済堅牢性 まで取り込み済み。
- `feature` は `a944a17`（優先クラスタ7件: guest-core-3/4, account-2/3, login-hooks-3, callback-1, stripe-webhook-6）が main より1コミット先（**未マージ・未デプロイ**）。
- DBマイグレ適用済み（両DB）: 1002/1004/1005/1006。
- ⚠️ 宿題: **ログインのサーバ化(1b32153, main済)の実地スモークテスト未確認**。**`a944a17` の feature→main マージ＋デプロイ**（account/scoreのフロー確認推奨）。

## Completed

### 2026-03-04 (Session 3)
- [x] 研修モードエクスポートのゲスト検定員名表示を修正
  - ゲストユーザーの検定員名が「不明」と表示される問題を修正
  - `session_participants` テーブルから `guest_name` を取得するように改善
  - 認証ユーザーとゲストユーザーの両方に対応

- [x] 招待サインアップのメール照合を改善（セキュリティ強化）
  - メール正規化関数を追加（大文字小文字、空白対応）
  - `normalizeEmail()` で `.trim().toLowerCase()` を実施
  - 完了ページでも同様の正規化を適用
  - 古いコメント（`admin.createUser` 参照）を更新
  - テストケースを追加（8テスト → 11テスト、全合格）
    - 大文字小文字の違い
    - 前後の空白
    - 両方の組み合わせ

- [x] 招待サインアップのメール確認フロー検証を強化（セキュリティ改善）
  - `signUp()` 後に `session` が `null` であることを検証
  - Supabase "Confirm email" 設定が無効な場合を検出
  - 設定ミス時に500エラーとセキュリティ警告を返す
  - アプリケーションレベルでメール確認を強制
  - テストケースを追加（11テスト → 12テスト、全合格）
    - session 存在時の設定ミス検出テスト
  - コメントを正確に修正（`email_confirm` パラメータに関する誤解を解消）

- [x] 認証コールバックのトークンハッシュフローを改善（信頼性向上）
  - `verifyOtp` のエラー判定をエラーコードベースに変更
  - PKCEフローと同様のパターンを適用（一貫性向上）
  - `error.code === 'invalid_grant'` と `error.code === 'otp_expired'` で判定
  - その他のエラーコードをログ出力
  - テストケースを追加（20テスト → 22テスト、全合格）
    - トークンハッシュフロー: invalid_grant のテスト
    - トークンハッシュフロー: otp_expired のテスト
    - トークンハッシュフロー: 予期しないエラーコードのテスト

- [x] 認証コールバックのユーザー向けエラー文言を固定化（セキュリティ強化）
  - PKCEフローの catch ブロックで `error?.message` を直接表示していた箇所を修正
  - 内部エラーメッセージの露出を防止
  - ユーザーには固定文言「認証処理中にエラーが発生しました。再度お試しください。」を表示
  - 詳細なエラー情報はサーバーログに記録（既存の実装を維持）
  - セキュリティリスク削減: システム情報の漏洩を防止

- [x] 招待サインアップで正規化後のメールアドレスを signUp() に渡すように修正（データ整合性改善）
  - 正規化比較後に未正規化メールを `signUp()` に渡していた問題を修正
  - `normalizedEmail` 変数を作成し、`signUp()` とログ出力の両方で使用
  - 空白付きメール（`" invited@example.com "`）や大文字メール（`"INVITED@EXAMPLE.COM"`）も正しく処理
  - テストを更新して正規化後のメールが `signUp()` に渡されることを検証（3テスト更新）
  - データ整合性向上: Supabase側で予期しないメール形式の問題を防止

- [x] 通常のサインアップを招待サインアップと同じセキュリティパターンに統一（一貫性向上）
  - メール正規化関数を追加（`normalizeEmail()`）
  - エラー検出を文字列マッチングからエラーコードベースに変更
    - `user_already_exists` / `email_exists` でuser_already_existsを返す
    - `over_email_send_rate_limit` でレート制限エラーを返す
    - その他のエラーコードをログ出力して汎用エラーを返す
  - session null チェックを追加（設定ミス検出）
  - `signUp()` に正規化後のメールを渡すように修正
  - テストを更新（7テスト、全合格）
    - エラーモックに `code: 'user_already_exists'` を追加
    - session 存在時のテスト期待値を500エラーに変更
  - 招待と通常のサインアップで一貫したセキュリティ実装を達成

- [x] ログインフローをサインアップと同じパターンに統一（一貫性向上）
  - メール正規化関数を追加（`normalizeEmail()`）
  - エラーコードベースのエラーハンドリングを実装
    - `invalid_credentials`: 無効な認証情報
    - `email_not_confirmed`: メール未確認
    - `too_many_requests` / status 429: レート制限
    - その他: 汎用エラーメッセージ
  - 正規化後のメールを `signInWithPassword()` に渡すように修正
  - ログ出力を追加（デバッグ用）
  - テストを作成（14テスト、全合格）
    - メール正規化のテスト（5テスト）
    - エラーコードマッピングのテスト（6テスト）
    - 統合シナリオのテスト（3テスト）
  - サインアップ、招待、ログインで一貫した認証実装を達成

- [x] サインアップと招待のエラーハンドリングにメッセージフォールバックを追加（信頼性向上）
  - エラーコード判定を優先しつつ、code が設定されていない場合のフォールバックを実装
  - code が空または undefined の場合、message で既存ユーザーを検出
    - "already registered", "already exists", "already been registered" を検出
  - code が設定されていない異常ケースでも 500 ではなく 409 を返すように改善
  - テストを追加（サインアップ: 7テスト → 10テスト、招待: 12テスト → 14テスト、全合格）
    - code が空の場合のフォールバック
    - code が undefined の場合のフォールバック
    - message がマッチしない場合の500エラー
  - Supabase の応答が不完全な場合でも適切に処理

- [x] 招待完了処理の競合問題を修正（信頼性向上・冪等性確保）
  - PostgreSQL 一意制約違反（error code: 23505）を成功として扱うように修正
  - 同時アクセス時に `existingMembership` チェック後の insert が競合しても、500 エラーではなく成功扱い
  - 対象となる3つの insert 操作すべてに適用:
    - 組織メンバー追加: 一意制約違反時は組織ページにリダイレクト
    - プロフィール作成: 一意制約違反時はログ出力して処理を継続
    - 招待使用履歴記録: 一意制約違反時はログ出力して処理を継続
  - エラーログに詳細情報（code, message, details）を記録
  - テストを作成（4テスト、全合格）
    - 組織メンバー追加時の一意制約違反を成功として扱う
    - プロフィール作成時の一意制約違反を成功として扱う
    - 招待使用履歴記録時の一意制約違反を成功として扱う
    - メンバー追加時の予期しないエラー（非23505）は500エラーを返す
  - 冪等性向上: 同じ招待リンクを複数回使用しても、最終的に同じ結果となる
  - ユーザー体験向上: 競合時に500エラーではなく成功として扱われる

- [x] signup と招待サインアップの入力検証を共通化（セキュリティ強化・保守性向上）
  - `/src/lib/server/validation.ts` の共通バリデーション関数を使用
    - `validateEmail()`: メールアドレスのバリデーション（空チェック、形式チェック、長さチェック、XSSサニタイズ）
    - `validateName()`: 名前のバリデーション（空チェック、長さチェック、XSSサニタイズ）
    - `validatePassword()`: パスワードのバリデーション（空チェック、長さチェック: 6-72文字）
  - 対象ファイル:
    - `/src/routes/signup/+page.server.ts`: 通常のサインアップ
    - `/src/routes/invite/[token]/+page.server.ts`: 招待サインアップ
  - サニタイズされた値を使用（XSS対策）
    - `sanitizedFullName`, `sanitizedEmail` を `signUp()` に渡す
    - fail() の返り値でもサニタイズされた値を使用
  - テストを更新
    - `/src/routes/signup/signup.test.ts`: エラーメッセージを更新（「氏名」→「名前」）
    - `/src/routes/invite/[token]/invite.test.ts`: エラーメッセージを更新（「すべてのフィールド」→ 各フィールドの詳細エラー）
    - `/src/lib/server/validation.test.ts`: `validatePassword()` のテストを追加（6テスト）
  - 全テスト合格（signup: 10/10、招待: 14/14、validation: 54/54）
  - 効果:
    - XSS対策: HTMLタグ、JavaScriptプロトコル、イベントハンドラを除去
    - 一貫性: 全ての入力フォームで同じバリデーションルールを使用
    - 保守性: バリデーションロジックを一箇所で管理、変更が容易

### 2026-03-03 (Session 2)
- [x] 招待サインアップのメールアドレス照合を必須化（セキュリティ修正）
  - `invitation.email`と入力`email`の一致チェックを追加
  - テストカバレッジを追加（7テスト、全合格）
  - `admin.createUser({ email_confirm: true })`使用時の重大な脆弱性を修正

- [x] 招待サインアップをメール確認フローに変更（セキュリティ改善）
  - `admin.createUser({ email_confirm: true })`から通常の`signUp()`に変更
  - メール所有の確認を必須化
  - メール確認画面（`/invite/[token]/check-email`）を追加
  - メール確認後の処理（`/invite/[token]/complete`）を実装
  - テストを更新（8テスト、全合格）

- [x] 認証コールバックのエラー判定を文字列依存からコード依存へ（信頼性向上）
  - `error.message.includes('invalid')`のような広すぎる条件を削除
  - `error.code`ベースの判定に変更（`invalid_grant`, `otp_expired`など）
  - 予期しないエラーコードの処理を追加
  - テストを拡充（11テスト → 13テスト、全合格）

- [x] nextパラメータのバリデーションをUUID v4形式に厳密化（セキュリティ強化）
  - `/organization/[a-f0-9-]+`から厳密なUUID v4形式に変更
  - UUID v4パターン: `xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx`
  - 招待完了パスのパターンも追加: `/invite/[token]/complete`（トークンは英数字とハイフン、最大64文字）
  - テストを拡充（13テスト → 20テスト、全合格）
    - UUID v4以外のバージョン（v1など）を拒否
    - 不正なバリアント（yの位置が8,9,a,b以外）を拒否
    - ハイフン欠けUUIDを拒否
    - パストラバーサル攻撃を拒否
    - 招待トークンの特殊文字、長さ制限を検証

### 2026-03-03 (Session 1)
- [x] 研修モードのゼッケン入力画面に「結果を見る」ボタンを追加
- [x] サインアップのメール送信診断ログを追加
- [x] auth/callbackテストのURL encoding問題を修正
- [x] ユーザーのコード変更（既存ユーザー検出、エラーメッセージ改善）を検証
- [x] プランアップグレードリンクの500エラーを修正（organizationLimits.ts）
- [x] サインイン/サインアップのredirect/error処理を修正（isRedirect/isHttpError使用）

## Review

### Latest Session Summary (2026-03-03 Session 2)
- **重大なセキュリティ改善**: 招待サインアップをメール確認フローに変更
- **第1の脆弱性（修正済み）**: `admin.createUser({ email_confirm: true })`使用時、招待トークンを知っていれば誰でも任意のメールアドレスでアカウント作成が可能だった
- **第2の脆弱性（修正済み）**: メール所有の確認をスキップしていたため、攻撃者が他人のメールアドレスで組織に参加できた
- **第3の脆弱性（修正済み）**: `next`パラメータのバリデーションが緩く、パストラバーサルやオープンリダイレクトのリスクがあった
- **修正内容**:
  1. `invitation.email`が設定されている場合、入力`email`との一致を検証（403エラーで拒否）
  2. `admin.createUser`から通常の`signUp()`に変更し、メール確認を必須化
  3. メール確認後に組織メンバー追加処理を実行するフローを実装
  4. 認証エラー判定を文字列マッチングから`error.code`ベースに変更
  5. `next`パラメータを厳密なUUID v4形式に制限し、パストラバーサルを完全防止
- **テストカバレッジ**: 20テストケース（招待8件、認証コールバック20件）で全セキュリティ修正を保護

### Key Changes (Session 2)
1. `/src/routes/invite/[token]/+page.server.ts`
   - 招待メールと入力メールの一致チェックを追加
   - `admin.createUser({ email_confirm: true })`から`supabase.auth.signUp()`に変更
   - メール確認画面にリダイレクト

2. `/src/routes/invite/[token]/check-email/+page.svelte` (新規作成)
   - メール確認を促す画面

3. `/src/routes/invite/[token]/complete/+page.server.ts` (新規作成)
   - メール確認後の組織メンバー追加処理
   - プロフィール作成
   - 招待使用履歴の記録

4. `/src/routes/invite/[token]/invite.test.ts`
   - 既存ユーザー検出のテスト（1件）
   - メールアドレス照合のテストケース（3件）
   - バリデーションテスト（3件）
   - 招待の有効性チェック（1件）
   - **全8テスト合格**

5. `/tasks/lessons.md`
   - 「Invitation Email Confirmation (CRITICAL SECURITY - IMPROVED)」セクションを更新
   - メール確認フローの実装パターンを追加
   - Common Mistakesを更新

6. `/src/routes/auth/callback/+server.ts`
   - `error.message.includes()`による文字列マッチングを削除
   - `error.code`ベースの判定に変更
   - `invalid_grant`, `otp_expired`, その他のエラーコードを個別に処理
   - エラーログを構造化して詳細情報を記録

7. `/src/routes/auth/callback/callback.test.ts`
   - OTP期限切れのテストケースを追加
   - 予期しないエラーコードのテストケースを追加
   - **全13テスト合格**（11 → 13テスト）

8. `/tasks/lessons.md`
   - 「Auth Error Code-Based Handling」セクションを追加
   - Common Mistakesにエラーコード判定の必須化を追加

9. `/src/routes/auth/callback/+server.ts` (再修正)
   - `next`パラメータの組織パスバリデーションをUUID v4形式に厳密化
   - UUID v4パターン: `/^\/organization\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/`
   - 招待完了パスのパターンを追加: `/^\/invite\/[a-zA-Z0-9-]{1,64}\/complete$/`
   - パストラバーサル攻撃、不正なUUID形式を完全に防止

10. `/src/routes/auth/callback/callback.test.ts` (再更新)
    - 組織パスのバリデーションテストを拡充（5テスト）
      - 有効なUUID v4形式の検証
      - UUID v1（非v4）の拒否
      - 不正なバリアント（8,9,a,b以外）の拒否
      - ハイフン欠けUUIDの拒否
      - パストラバーサル攻撃の拒否
    - 招待完了パスのバリデーションテストを追加（4テスト）
      - 有効な招待パスの検証
      - 特殊文字を含むトークンの拒否
      - 長すぎるトークン（65文字以上）の拒否
      - 不正なエンドポイント（complete以外）の拒否
    - **全20テスト合格**（13 → 20テスト）

### Previous Session Summary (2026-03-03 Session 1)
- **研修モードUI改善**: ゼッケン入力画面から結果画面へのアクセスを追加
- **認証フロー修正**: SvelteKitの`redirect()`/`error()`の正しい処理を実装
- **組織プラン機能**: upgradeUrlを動的組織IDベースに修正
- **メール送信診断**: Supabaseの設定問題を特定するためのログを追加

## Next Steps

- ✅ **CRITICAL**: 招待サインアップのセキュリティホールを修正（完了）
- ✅ **CRITICAL**: 招待サインアップのメール確認フローを実装（完了）
- Test invitation signup flow end-to-end with actual email confirmation
- Review all other uses of `admin.createUser()` in the codebase for similar vulnerabilities
- Monitor signup email delivery in production
- Verify all authentication flows work correctly
- Test organization plan upgrade flow end-to-end

---

## ゲスト得点入力 監査 → バッチ1 修正（2026-06-27）

多エージェント監査（7次元／敵対的検証、確定23件）の結果のうち、**RLS/DBスキーマを触らない局所修正**だけを実施。
本番RLSドリフトや所有権キー設計を要する項目（#1,#6〜#10,A/B）は **バッチ2** に分離（未着手）。

### 実施した修正
- [x] **#2 eventInfo=null で500クラッシュ** — `input/+page.server.ts` の `load` に `if (!eventInfo) throw error(404, …)` を追加（participantガードと対称）。あわせて `status/+page.server.ts` の大会モードクエリを `eventInfo?.discipline/level/event_name` に（completeページと対称化）。
- [x] **#3 失敗submit後にキーパッドが固まる** — `input/+page.svelte` の `use:enhance` を `async ({ update }) => { await update({ reset:false }); loading=false; }` に変更。失敗時も再入力可能に。
- [x] **#4 空入力の確定で幻の0点** — `ScoreInput.svelte` の `handleConfirm` 先頭で `currentScore===''` を弾く（`m.score_inputError()` / `m.score_enterScore()` 再利用、新規i18nキー無し）。
- [x] **#5 研修結果ページがゲストに空表示** — `results/+page.server.ts` を URL `?guest=` ではなく JWT検証済み `guestParticipant.guest_identifier` で絞り込み。
- [x] **#11 生DBエラーのクライアント返却を停止** — `input/+page.server.ts`（saveError/insertError）、`join/+page.server.ts`（×3）、`scoreActions.ts` を固定文言に。`console.error` には raw error を保持。
- [x] **#12 PII/capabilityログ削減** — `input/+page.server.ts`・`results/+page.server.ts` から guest_identifier・guest_name・フルURL・score・judge_name のinfoログを除去。

### 検証
- [x] 新規 `src/lib/components/ScoreInput.test.ts`（4テスト）: 空確定→アラート/未送信、通常値→送信、明示的0→送信、範囲外→範囲エラー。
- [x] 既存 `scoreActions.test.ts` を更新: 生DBメッセージ非開示を検証（`not.toContain('RLS policy violation')`）。
- [x] **全テスト 680 passed / 0 failed**（+4、11 skipped）。
- [x] **型チェック**: 新規エラー0。`@testing-library/jest-dom/vitest` 取り込みで既存matcher型エラーも解消し 311→256 に減少。
- [ ] 手動E2E（稼働中Supabase必要）: 種目不正ID→404、失敗submit後の再入力、空確定の警告、研修結果表示 — 未実施（要ステージング）。

### バッチ2（第1次・未着手・要設計判断/DB変更）
#1 ゲスト判定のJWT化（`+layout.svelte`/`supabaseClient.ts`）、#7 `results` 所有者列＋RLS/onConflict（同名なりすまし上書き）、#8 `training_events` anon SELECT migration、#9 join rate-limit、#10 旧検定フロー是正、A（横断SELECT `USING(true)`）、B（マルチ審判 requiredJudges 算出）。

---

## 第2次監査 → 採点フロー堅牢化 バッチ（2026-06-27）

第2次監査8指摘を実コードで敵対的検証（confirmed/refuted/partial）し、**実在するコードのみ修正可能**な5件を実装。
判定: #2=誤り(006が judge_id を uuid 化済・対応不要)、#8(同名delete) と #7(results judge_id) はDB変更要件のため次バッチへ。

### 実施した修正（DB/RLS変更なし）
- [x] **#4 採点入力ページの認可（Med・実在）** — `input/+page.server.ts` の `load`/`submitScore` に、`isMultiJudge && !isChief && !guestParticipant` のとき **主任が指定した active prompt の bib のみ**許可するガードを追加（不一致は load=redirect / submit=403）。主任・ゲストは従来どおり制約せず採点フローを壊さない。共通ヘルパ `fetchActivePrompt`（`sessionHelpers.ts`）を新設。
- [x] **#6 navigationMonitor 停滞（Med・confirmed）** — `sessionNavigationMonitor.ts`：participant 未解決時は bib のみで input へ、prompt 取得失敗時はスコアベースへフォールバック遷移（無音no-op廃止）。`input/+page.server.ts` load：`participantId` 欠落時に bib から解決し着地できるように。
- [x] **#1 研修保存の競合（Low）** — INSERT が `23505`（並行重複）なら同一アイデンティティで UPDATE にフォールバックし 500 を返さない（得点は1件目で保存済み）。
- [x] **#5 submitBib の沈黙成功（Low）** — `+page.server.ts`：`active_prompt_id` UPDATE 失敗時に挿入済み prompt を掃除して `fail(500)` を返す（従来は success:true で伝播せず）。
- [x] **#3 finalizeScore 冪等化（Low）** — `status/+page.server.ts`：`fetchActivePrompt` で今回の bib の prompt が active な場合のみ compare-and-swap で `active_prompt_id` をクリア（二度押し/次滑走者 prompt を誤消去しない）。

### 検証
- [x] 新規 `sessionHelpers.test.ts`（fetchActivePrompt 4件）＋ `input/page.server.test.ts` に #1 冪等ロジックミラー4件。
- [x] **全テスト 688 passed / 0 failed**（+8、11 skipped）。
- [x] 型チェック **256（新規エラー0）**、eslint 新規エラー0、prettier整形済み。
- [ ] 手動E2E（要稼働Supabase）: 一般審判が直URLで別bib→403／主任が次滑走者へ進めると審判が遷移（participant解決失敗でもフォールバック）／研修二重送信で500なし／submitBib失敗でエラー表示／確定二度押しで次prompt不消去 — 未実施（ステージング推奨）。

### 次バッチ（要DB/設計）
#2(対応不要)、#7 `results` judge_id 列＋RLS/onConflict、#8 delete-user 主任ガード＋`sessions.chief_judge_id` FK整備＋base sessions schema 収録、本番スキーマ/RLSドリフト突合。第1次バッチ2残件も継続。

---

## 第2次監査 #8 → アカウント削除の所有権引き継ぎ バッチ（2026-06-27）

ユーザー判断によりアプリのみ（DB/FK/スキーマ変更なし）で実装。#7 は「アプリ暫定ガード」として次バッチへ分離、sessions の FK 移行も別途。

### 調査で確定した前提
- `sessions` の UPDATE RLS は **org メンバーシップ基準**（030 "Organization members can manage sessions" FOR ALL）。→ `chief_judge_id` がダングリング/NULL でも org メンバーが `appointChief` で再任命可能（chief は回復可能）。
- `removeParticipant`/`removeGuest` は **`created_by === user.id` をアプリ層で必須** → `created_by` がダングリング/NULL だと検定員管理が恒久不能（再任命でしか回復しない）。
- `sessions.chief_judge_id`/`created_by` は FK 喪失（030でdrop・再追加なし）、base sessions schema はリポジトリ未収録。

### 実施した修正（#8）
- [x] `src/routes/api/delete-user/+server.ts`：`deleteUser` 直前に **service role で所有権を残存メンバーへ引き継ぐ**処理を追加（全ガード通過後）。対象セッションを `.or(chief_judge_id.eq / created_by.eq)` で取得→各セッションの残存非ゲストメンバー1名へ `chief_judge_id`/`created_by` を再任命。置換者なしは chief のみ NULL（created_by は NOT NULL 回避のため不変）。**best-effort**（失敗してもアカウント削除は継続）。
- [x] 純ロジックを `src/lib/server/sessionOwnership.ts` の `computeOwnershipReassign` に分離（env/stripe を import せずテスト可能に）。

### 検証
- [x] 新規 `sessionOwnership.test.ts`（6件）：置換者あり→両方再任命／なし→chief NULL・created_by不変／chief のみ・creator のみ・対象外・null セッション。
- [x] **全テスト 694 passed / 0 failed**（+6、11 skipped）。
- [x] 型チェック **256（新規エラー0）**、eslint 新規エラー0（残り1件は既存 Stripe catch の any）、prettier整形済み。
- [ ] 手動E2E（要稼働Supabase）: (a) 複数メンバーで chief 兼 creator を削除→別メンバーへ引き継ぎ・管理継続／(b) 単独作成者を削除→chief NULL（appointChief 可）・削除成功／(c) org sole-admin・Stripe 失敗時は従来どおりブロック — 未実施（ステージング推奨）。

### 次バッチ（要DB/設計・継続）
#7 アプリ暫定ガード（join名前一意化＋自名義以外採点拒否）／results owner 列移行は将来。sessions の FK 移行（chief_judge_id/created_by に ON DELETE SET NULL）は base sessions schema 突合の上で。第1次バッチ2残件（JWTゲスト判定・training_events anon・join rate-limit・旧フロー・横断SELECT・requiredJudges）。

---

## #7 暫定 → セッション内の検定員名を join 時に一意化 バッチ（2026-06-27）

ユーザー判断によりアプリのみ（results owner 列移行＝恒久対策は将来）。「自名義以外での採点拒否」は `getJudgeName` のサーバ側導出＋RLS(1000/1001) で**既に成立**しているため、本バッチの追加変更は join 名前一意化のみ。

### 実施した修正
- [x] `src/lib/server/sessionHelpers.ts`：`normalizeJudgeName`（trim+NFC+小文字）＋ `isJudgeNameTakenInSession(admin, sessionId, name)` を追加。セッション内の既存 guest_name と、認証メンバーの profiles.full_name を正規化一致で照合（ゲストが既存メンバー名を騙るのも防止）。
- [x] `src/routes/session/join/+page.server.ts`（ゲスト分岐）＋ `src/routes/session/invite/[token]/+page.server.ts`：insert 直前に一意チェックを追加、衝突は **409**（ハードコード文言）。

### 検証
- [x] `sessionHelpers.test.ts` に `isJudgeNameTakenInSession` の6ケース（完全一致／空白・大小無視／メンバー名なりすまし／不一致／空候補／guest_name null）。
- [x] join action test に「同名は409・INSERTしない」配線テストを追加。既存 join/invite action test の supabaseAdmin モックに `session_participants.select().eq()` を補い回帰修復。
- [x] **全テスト 701 passed / 0 failed**（+7、11 skipped）。
- [x] 型チェック **256（新規エラー0）**、eslint 変更ファイル0件、prettier整形済み。
- [ ] 手動E2E（要稼働Supabase）: 既存 '田中'/認証 '山田太郎' のセッションに同名（'田中'/' 田中 '/'TANAKA'/'山田太郎'）でゲスト join→409・未登録／新規名は従来どおり join 可 — 未実施（ステージング推奨）。

### 既知の残課題（DB/RLS 必要・将来）
- TOCTOU（同名同時 join）：DB ユニーク制約が無いため best-effort。将来 `UNIQUE(session_id, guest_name) WHERE is_guest` で根治。
- 認証 vs 認証の同名（profiles.full_name はグローバル）＋ 999 の authed INSERT RLS に judge_name チェック無し疑い → results owner 列（judge_id）＋RLS 改修（恒久 #7）で対応。
- sessions FK 移行、本番スキーマ/RLS 突合、第1次バッチ2残件。

---

## 本番スキーマ/RLS 突合 診断 バッチ（2026-06-27）

DB/RLS の残作業は全て破壊的変更だが本番が手動適用でドリフトしており repo migration は正本でない。推測での migration 化を避けるため、まず実態を吸い出す read-only 診断を用意（ユーザー判断）。

### 成果物
- [x] `database/diagnostics/audit_schema_rls.sql`（新規・**READ-ONLY**）。対象10テーブルについて 5クエリ：(1)列定義 (2)制約+FK ON DELETE (3)索引(部分/unique含む) (4)RLS有効フラグ (5)全ポリシー。
- [x] read-only 検証：非コメント行に CREATE/ALTER/DROP/INSERT/UPDATE/DELETE/TRUNCATE/GRANT/REVOKE/MERGE 無し。SELECT×5。

### 運用（ユーザー実行）
- [x] Supabase SQL Editor で prod・dev 両方に実行し結果を受領（2026-06-27）。突合結果は memory [prod-schema-rls-drift] に記録。

### 突合で判明した重大所見（再優先順位）
- 🔴 **CRIT（本番のみ）**: `results` に `authenticated_users_{insert,select,update}_results = true` ポリシー → 任意の認証ユーザーが**全org/全セッションの results を読取・改変**可能。スコープ付き正ポリシーを OR で無効化。dev には無い。
- 🟠 **HIGH（両環境）**: `sessions` anon SELECT `USING true` → anon が全セッション＝**join_code / invite_token を読める**（参加コードゲート実質バイパス）。prod に "Temporary realtime test" USING true も残存。
- 🟠 **HIGH（本番）**: `scoring_prompts` anon INSERT/UPDATE `true` → 越境プロンプト改ざん。
- 🟡 **MED**: `participants`/`session_participants` anon SELECT `true` → 越境PII（選手名・bib・ゲスト名）。
- ℹ️ `sessions.created_by` FK：prod=auth.users **ON DELETE CASCADE**（作成者削除でセッション連鎖削除）／dev=profiles NO ACTION。batch-3 の再任命は replacement 有時に連鎖を回避。
- ✅ 非問題確定：`training_events` anon SELECT 有り（両）／`training_scores.judge_id` uuid＋部分一意索引 有り（両）。
- results 恒久#7 用：judge_id/guest_identifier **列なし**、score=bigint、UNIQUE名 prod=`results_unique_score_entry`+`unique_result_per_judge` / dev=`results_unique_score`+`unique_result_per_judge`、results.id は prod=bigint/dev=uuid。

### 次バッチの推奨順（結果を踏まえ再優先）
1. **RLS ロックダウン（最優先）**: results の `authenticated_users_*=true` を削除し owner/セッション基準へ；sessions の anon `USING true`＋"Temporary realtime test" を JWT/セッション参加スコープへ；scoring_prompts の anon write 制限；participants/session_participants の横断SELECT締め直し。prod/dev 差を吸収する冪等 migration。
2. **#7 恒久**: results に owner 列（judge_id/guest_identifier）＋ owner 基準の UNIQUE/onConflict、既存二重UNIQUEを置換、アプリ write/read 改修。
3. **#8 仕上げ**: sessions.chief_judge_id に FK(ON DELETE SET NULL)、created_by の prod CASCADE 方針確認、base sessions schema を repo 収録。
※ いずれも prod/dev 双方へ手動適用する numbered migration＋ロールバック手順付きで設計。

---

## RLS ロックダウン migration バッチ（2026-06-27）

ユーザー判断により4テーブル（results/scoring_prompts/participants/session_participants）の RLS のみ。sessions は次バッチ（join/invite の service-role 化を要する）。

### 成果物（DBのみ・アプリ変更なし）
- [x] `database/migrations/1007_rls_lockdown_cross_session.sql`（冪等・名前指定 DROP IF EXISTS で prod/dev 差吸収・末尾に検証スナップショット）
  - results: `authenticated_users_{select,insert,update}_results`(=true) を撤去（スコープ付き正ポリシーは維持）。
  - scoring_prompts: 全 true を撤去→ anon=JWT(session_id)／authed=参加スコープ（FOR ALL）。
  - participants: 過剰 true を撤去→ anon SELECT/INSERT=JWT、authed INSERT=参加スコープ追加（作成者管理は維持）。
  - session_participants: 越境 SELECT を撤去→ anon=JWT、authed=`is_session_member(session_id) OR user_id=auth.uid()`。再帰回避の SECURITY DEFINER 関数 `is_session_member` を冪等作成。
- [x] `database/migrations/1007_rollback_rls_lockdown.sql`（緊急復帰・穴を再導入する旨を明記）。
- [x] 静的検証：create policy 7件は各々 DROP IF EXISTS 先行（冪等）／破壊的 DDL/DML 無し。
- [x] 回帰：`npm run test` 701 passed（アプリ無変更）。
- [x] 適用時に判明した 2 つの環境差を吸収（再修正済み）:
  - section0 のヘルパは `CREATE OR REPLACE`（42P13 引数名変更）→「create を試し 42723 なら既存再利用」の例外ハンドラ方式へ。prod の `is_session_member(session_uuid bigint)` をそのまま再利用。
  - `session_participants` の authed `=true` SELECT がポリシー名で環境差（prod=`"Authenticated users can view participants"` / dev=`"... session participants"`）→ 両名を DROP。

### 運用（ユーザー実行・完了）
- [x] **DEV 適用 → over-broad(true)=0 確認**（2026-06-27）。
- [x] **PROD 適用 → over-broad(true)=0 確認**（2026-06-27）。results の chief 削除ポリシーは正しく残存。
- [ ] 機能 E2E（DEV/PROD・推奨）：ゲスト join→大会/研修採点→status realtime→scoreboard／認証 審判・主任の bib確定(prompt+participant自動作成)→採点(upsert)→finalize。越境読取が不可になったこと。
- [ ] 既知エッジ監視：profile.full_name 未設定ユーザーの results 再採点（UPDATEポリシー）／セッション非参加 org 管理者の results・participants 直読。問題が出たら追補。
- 問題時は `1007_rollback_rls_lockdown.sql`。

### 次バッチ
sessions anon ロックダウン（join/invite の supabaseAdmin 化＋anon SELECT を JWT スコープ＋"Temporary realtime test"/authed `auth.role()='authenticated'` 撤去）、#7 恒久（results owner 列）、#8 sessions FK。

---

## sessions anon ロックダウン バッチ（2026-06-27）

anon の sessions 全読み（join_code/invite_token 漏洩＝参加コード/招待ゲート実質バイパス）＋公開スコアボードの `select('*')` 機微列露出を封鎖。**アプリ変更＋RLS migration の組み合わせ**で、**アプリを先にデプロイ→migration を DEV→prod** の順。

### 実施した変更
- [x] アプリ（事前認証/公開の sessions 参照を service-role 化）:
  - `session/join/+page.server.ts`：参加コード照合を `supabaseAdmin` に＋ガード、`checkCanAddJudgeToSession(supabaseAdmin,…)`。
  - `session/invite/[token]/+page.server.ts`：load/action の invite_token 照合を `supabaseAdmin` に＋ガード、`checkCanAddJudgeToSession(supabaseAdmin,…)`。
  - `scoreboard/[sessionId]/+page.server.ts`（公開）：sessions/custom_events/results を `supabaseAdmin` に。sessions は `select('id, name, is_tournament_mode')` に絞り **join_code/invite_token を出さない**。
- [x] `database/migrations/1008_sessions_anon_lockdown.sql`（冪等）：過剰 anon/public SELECT を撤去（prod/dev 別名網羅）→ `anon_sessions_select_by_jwt`（`id = JWT session_id`）。authed のスコープ付き SELECT は維持。
- [x] `database/migrations/1008_rollback_sessions_anon_lockdown.sql`（緊急復帰）。
- [x] 回帰：`npm run test` 701 passed／型 256（新規0）／eslint・prettier 新規問題なし（join 266/271・scoreboard `_` は既存）。

### 運用（ユーザー実行・未実施／順序厳守）
- [ ] **アプリを先にデプロイ**（service-role 参照）。この時点では旧 RLS でも動く。
- [ ] **DEV に 1008 適用** → 末尾 `Remaining broad ... : 0` 確認。
- [ ] DEV 手動E2E：参加コードjoin（未ログイン＆ログイン非メンバー）／招待リンク表示＋join／ゲスト在席（採点・active_prompt_id realtime・status・complete）／公開 `/scoreboard/[sessionId]` が未ログインで表示＆ join_code/invite_token がレスポンスに無い／anon が他セッションの sessions を列挙できない。
- [ ] DEV 通過後に **prod 適用**。問題時は 1008_rollback。

### 次バッチ
#7 恒久（results owner 列）、#8 sessions FK＋base sessions schema 収録、ダッシュボードの sessions DELETE 無フィルタ購読（authed スコープ化で自然縮小・必要なら別途）、第1次バッチ2残件。
