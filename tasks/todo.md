# Current Tasks

## Active

- [ ] None

## Completed

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
