# Current Tasks

## Active

- [ ] None

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
