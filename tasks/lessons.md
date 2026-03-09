# Project Lessons & Patterns

このファイルには、judge-appプロジェクトで学んだ重要なパターン、よくあるミス、プロジェクト固有のルールを記録します。

## SvelteKit Patterns

### ✅ Auth Error Code-Based Handling
**Rule**: Supabase認証エラーは`error.code`で判定し、文字列マッチング（`error.message.includes()`）は避ける

**Wrong (誤判定のリスク):**
```typescript
if (error.message.includes('invalid') ||
    error.message.includes('code verifier') ||
    error.message.includes('already been used')) {
  // ❌ 広すぎる条件：意図しないエラーまで捕捉する可能性
  // ❌ メッセージ文言の変更に弱い
  // ❌ 言語依存（多言語対応時に問題）
}
```

**Correct (エラーコードベース):**

PKCEフロー（`exchangeCodeForSession`）:
```typescript
if (error.code === 'invalid_grant') {
  // ✅ コードが無効、期限切れ、または既に使用済み
  console.log('[auth/callback] invalid_grant検出');

  // 既に認証済みかチェック
  const { data: { user: currentUser } } = await supabase.auth.getUser();
  if (currentUser) {
    throw redirect(303, '/dashboard');
  }

  throw redirect(303, '/login?error=...');
}

if (error.code === 'otp_expired') {
  // ✅ OTP/コードが期限切れ
  throw redirect(303, '/login?error=期限切れメッセージ');
}

// その他の予期しないエラー
console.error('[auth/callback] 予期しないエラーコード:', error.code);
throw redirect(303, '/login?error=汎用エラーメッセージ');
```

トークンハッシュフロー（`verifyOtp`）:
```typescript
if (error.code === 'invalid_grant' || error.code === 'otp_expired') {
  // ✅ トークンが無効、期限切れ、または既に使用済み
  console.log('[auth/callback] トークンが使用済み/無効/期限切れ');
  throw redirect(303, '/login?error=...');
}

// その他の予期しないエラー
console.error('[auth/callback] 予期しないエラーコード:', error.code);
throw redirect(303, '/login?error=汎用エラーメッセージ');
```

**Correct with Fallback (エラーコードベース + messageフォールバック):**

サインアップ（`signUp`）:
```typescript
// エラーコードベースの判定（推奨）
if (authError.code === 'user_already_exists' ||
    authError.code === 'email_exists') {
  return fail(409, { error: '既存ユーザーエラー' });
}

// フォールバック: error.code が設定されていない場合、message で判定
// code が設定されている場合は、このブロックは実行されない
if (!authError.code || authError.code === '') {
  const message = authError.message?.toLowerCase() || '';

  // 既存ユーザーを示す具体的なメッセージパターン
  if (message.includes('already registered') ||
      message.includes('already exists') ||
      message.includes('already been registered')) {
    console.warn('Detected existing user via message fallback:', authError.message);
    return fail(409, { error: '既存ユーザーエラー' });
  }
}

// その他の予期しないエラー
console.error('Unexpected error code:', authError.code);
return fail(500, { error: 'サーバーエラー' });
```

**Common Supabase Auth Error Codes:**
- `invalid_grant`: コードが無効、期限切れ、または既に使用済み
- `otp_expired`: OTP/コードが期限切れ
- `user_already_exists` / `email_exists`: 既存ユーザー
- `validation_failed`: バリデーションエラー
- `provider_email_needs_verification`: メール確認が必要

**Why**:
- エラーコードは安定したAPI仕様の一部（優先して使用）
- 文字列マッチングは広すぎて誤判定のリスクがあるが、**code が設定されていない異常ケースのフォールバックとして使用**
- メッセージ文言の変更や多言語化に対応できる
- 意図しないエラーを捕捉しない
- **重要**: code が設定されていない場合でも、既存ユーザーエラーを正しく処理できる

**Message Fallback Pattern:**
- エラーコードを優先（推奨される方法）
- code が空または undefined の場合のみ、**限定的な** message フォールバックを使用
- message 判定は非常に具体的な文字列に限定（"already registered", "already exists" など）
- これにより、Supabase の応答が不完全な場合でも、既存ユーザーが 500 エラーではなく 409 エラーとして適切に処理される

**Affected Files**:
- `/src/routes/signup/+page.server.ts` (サインアップ + フォールバック)
- `/src/routes/invite/[token]/+page.server.ts` (招待サインアップ + フォールバック)
- `/src/routes/auth/callback/+server.ts` (認証コールバック)
- `/src/routes/signup/signup.test.ts` (サインアップテスト - 10テスト、フォールバック含む)
- `/src/routes/invite/[token]/invite.test.ts` (招待テスト - 14テスト、フォールバック含む)
- `/src/routes/auth/callback/callback.test.ts` (認証コールバックテスト)

**References**:
- [Supabase Auth Error Codes](https://supabase.com/docs/reference/javascript/auth-error-codes)

---

### ✅ User-Facing Error Messages (SECURITY)
**Rule**: ユーザーに表示するエラーメッセージは固定文言を使用し、内部エラーメッセージを露出しない

**Wrong (内部エラーの露出):**
```typescript
} catch (error: any) {
  // ❌ 内部エラーメッセージをそのまま表示（セキュリティリスク）
  throw redirect(303, `/login?error=${encodeURIComponent('認証処理中にエラーが発生しました: ' + (error?.message || '不明なエラー'))}`);
}
```

**Correct (固定文言):**
```typescript
} catch (error: any) {
  // SvelteKitのredirect/errorは再throw
  if (isRedirect(error) || isHttpError(error)) {
    throw error;
  }

  // 詳細なエラー情報はログに記録（内部用）
  console.error('[auth/callback] コード交換処理エラー:', error);
  console.error('[auth/callback] エラータイプ:', typeof error);
  console.error('[auth/callback] エラー内容:', JSON.stringify(error, null, 2));

  // ✅ ユーザーには固定文言を表示（内部エラーメッセージを露出しない）
  throw redirect(303, `/login?error=${encodeURIComponent('認証処理中にエラーが発生しました。再度お試しください。')}`);
}
```

**Why**:
- 内部エラーメッセージの露出はセキュリティリスク（システム情報の漏洩）
- 攻撃者にシステムの内部実装を推測される可能性がある
- ユーザーフレンドリーな固定文言の方が理解しやすい
- 詳細なエラーはサーバーログで確認すればよい

**Security Impact**: MEDIUM - 情報漏洩のリスク、攻撃者による偵察の材料となる

**Affected Files**:
- `/src/routes/auth/callback/+server.ts`

---

### ✅ Redirect/Error Handling
**Rule**: SvelteKitの`redirect()`と`error()`は例外をthrowするため、catch blockで再throwする必要がある

**Wrong:**
```typescript
try {
  await someAsyncOperation();
  throw redirect(303, '/dashboard');
} catch (err) {
  // redirectが捕捉されてエラーとして処理される（間違い）
  console.error(err);
  return fail(500, { error: 'Failed' });
}
```

**Correct:**
```typescript
import { redirect, error, isRedirect, isHttpError } from '@sveltejs/kit';

try {
  await someAsyncOperation();
  throw redirect(303, '/dashboard');
} catch (err: any) {
  // SvelteKitのredirect/errorは再throw
  if (isRedirect(err) || isHttpError(err)) {
    throw err;
  }
  console.error(err);
  return fail(500, { error: 'Failed' });
}
```

**Why**: `redirect()`と`error()`は制御フローの一部であり、エラーではない。これらを捕捉すると正しくリダイレクトされない。

**Affected Files**:
- `/src/routes/auth/callback/+server.ts`
- `/src/routes/api/stripe/**/*.ts`
- Any file that uses redirect/error in try-catch blocks

---

### ✅ URL Parameter Validation (Open Redirect Prevention)
**Rule**: `next`パラメータなどのリダイレクト先は厳密にバリデーションし、オープンリダイレクトやパストラバーサル攻撃を防止する

**Wrong (緩いバリデーション):**
```typescript
const UUID_PATTERN = /^\/organization\/[a-f0-9-]+$/;  // ❌ 緩すぎる
const isOrganizationPath = UUID_PATTERN.test(nextParam);

// 問題:
// - /organization/../../../etc/passwd がマッチする可能性
// - UUIDv1, v3, v5などもマッチする（セキュリティ上の区別が必要な場合に問題）
// - ハイフンなしのUUID（550e8400e29b41d4a716446655440000）もマッチする可能性
```

**Correct (UUID v4形式に厳密化):**
```typescript
// UUID v4形式に厳密化：xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
// - x: 16進数 (0-9a-f)
// - 4: バージョン4固定
// - y: バリアント (8, 9, a, b のいずれか)
const UUID_V4_PATTERN = /^\/organization\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const isOrganizationPath = UUID_V4_PATTERN.test(nextParam);

// 招待完了ページへのリダイレクトを許可（/invite/[token]/complete）
// トークンは英数字とハイフンのみ（最大64文字）
const INVITE_COMPLETE_PATTERN = /^\/invite\/[a-zA-Z0-9-]{1,64}\/complete$/;
const isInviteCompletePath = INVITE_COMPLETE_PATTERN.test(nextParam);

// ホワイトリスト方式で許可パスを厳密に制限
const allowedPaths = ['/dashboard', '/onboarding/create-organization', '/account'];
const next = (allowedPaths.includes(nextParam) || isOrganizationPath || isInviteCompletePath)
  ? nextParam
  : '/onboarding/create-organization';

if (nextParam !== next) {
  console.warn('[auth/callback] 不正なリダイレクト先を検出。デフォルトにリダイレクト:', nextParam);
}
```

**Why**:
- **UUID v4形式の厳密化**: 不正なUUID形式、パストラバーサル（`..` を含む）を完全に防止
- **バージョン固定**: UUID v4のみを許可し、他のバージョン（v1, v3, v5）を拒否
- **バリアント検証**: RFC 4122準拠のバリアント（8, 9, a, b）のみを許可
- **長さ制限**: 招待トークンは最大64文字に制限し、長すぎるトークンを拒否
- **ホワイトリスト方式**: ブラックリスト（禁止パターン）ではなく、ホワイトリスト（許可パターン）で制限

**Test Coverage**:
```typescript
// 有効なUUID v4 (✅ 許可)
'/organization/550e8400-e29b-41d4-a716-446655440000'

// UUID v1 (❌ 拒否 - バージョンが1)
'/organization/550e8400-e29b-11d4-a716-446655440000'

// 不正なバリアント (❌ 拒否 - yの位置がf)
'/organization/550e8400-e29b-41d4-f716-446655440000'

// ハイフンなし (❌ 拒否)
'/organization/550e8400e29b41d4a716446655440000'

// パストラバーサル (❌ 拒否)
'/organization/../../etc/passwd'

// 有効な招待完了パス (✅ 許可)
'/invite/abc123-def456/complete'

// 特殊文字を含む招待トークン (❌ 拒否)
'/invite/abc@123/complete'

// 長すぎるトークン (❌ 拒否 - 65文字)
'/invite/aaaaa...65文字.../complete'
```

**Security Impact**: CRITICAL - オープンリダイレクト脆弱性やパストラバーサル攻撃を防止

**Affected Files**:
- `/src/routes/auth/callback/+server.ts`
- `/src/routes/auth/callback/callback.test.ts` (20テストケース)

**Common Mistakes**:
- ❌ `[a-f0-9-]+` のような緩いパターンを使用する
- ❌ ブラックリスト方式（`.includes('..')` など）で禁止パターンを列挙する
- ❌ バリデーション前に `decodeURIComponent()` を適用する（エンコード回避攻撃のリスク）
- ❌ 相対パス（`../`）を許可する
- ❌ 外部URL（`https://evil.com`）を許可する

---

## Supabase Patterns

### ✅ Existing User Detection
**Rule**: Supabaseは既存ユーザーが再登録を試みた際、エラーではなく空の`identities`配列を返す

**Pattern:**
```typescript
const { data: authData, error: authError } = await supabase.auth.signUp({
  email,
  password,
  options: { ... }
});

// エラーチェック
if (authError) {
  // 通常のエラー処理
}

// 既存ユーザー検出（重要！）
if (authData.user && Array.isArray(authData.user.identities) && authData.user.identities.length === 0) {
  return fail(409, {
    error: 'このメールアドレスは既に登録されています。ログインしてください。'
  });
}
```

**Why**: Supabaseはメールアドレスの列挙攻撃を防ぐため、既存ユーザーでもエラーを返さない。`identities`配列が空の場合のみ既存ユーザーと判断できる。

**Affected Files**:
- `/src/routes/signup/+page.server.ts`

---

### ✅ Email Confirmation Diagnosis
**Rule**: メール確認の有無を診断するには、`session`と`email_confirmed_at`をチェックする

**Pattern:**
```typescript
console.log('[signup] signUp 成功:', {
  hasSession: !!authData.session,
  emailConfirmedAt: authData.user?.email_confirmed_at,
});

// セッションが即座に作成 = Autoconfirm有効（メール確認スキップ）
if (authData.session) {
  console.warn('[signup] ⚠️ Autoconfirmが有効です');
}
```

**Why**: Supabaseの"Enable email confirmations"がオフの場合、サインアップ時に即座にセッションが作成される。これを検出することでメール送信問題を診断できる。

---

### ✅ Invitation Email Confirmation (CRITICAL SECURITY - IMPROVED)
**Rule**: 招待サインアップでは必ずメール所有を確認する。`admin.createUser({ email_confirm: true })`は使用しない。

**Wrong (SECURITY HOLE - OLD IMPLEMENTATION):**
```typescript
// ❌ メール所有の確認をスキップ（危険！）
await supabaseAdmin.auth.admin.createUser({
  email,
  password,
  email_confirm: true  // ← 即座に有効化、メール所有を確認していない
});

// 問題点：
// 1. 招待リンクを入手すれば、メール所有を証明せずにアカウント作成可能
// 2. invitation.emailとの照合があっても、メール所有の確認がない
// 3. 攻撃者が他人のメールアドレスで組織に参加できてしまう
```

**Correct (CURRENT IMPLEMENTATION):**
```typescript
// メール正規化関数（大文字小文字、空白対応）
function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

// 招待情報を取得
const { data: invitation } = await supabaseAdmin
  .from('invitations')
  .select('*')
  .eq('token', token)
  .single();

// メールアドレスを正規化（大文字小文字、空白を統一）
// signUp()にも正規化後のメールを渡すことで、データの一貫性を保つ
const normalizedEmail = normalizeEmail(email);

// ✅ 招待メールが指定されている場合、正規化して入力メールと一致するかチェック
if (invitation.email && normalizeEmail(invitation.email) !== normalizedEmail) {
  return fail(403, {
    error: 'この招待は別のメールアドレス宛です。招待されたメールアドレスを使用してください。'
  });
}

// ✅ 通常のサインアップフローを使用（メール確認必須）
// Supabase設定で "Confirm email" が有効な場合、session は null となる
// 正規化後のメールアドレスを使用することで、データの一貫性を保つ
const { data: authData, error: authError } = await locals.supabase.auth.signUp({
  email: normalizedEmail,  // ← 正規化後のメールを使用
  password,
  options: {
    data: {
      full_name: fullName,
      invitation_token: token  // メール確認後に使用
    },
    emailRedirectTo: `${PUBLIC_SITE_URL}/auth/callback?next=/invite/${token}/complete`
  }
});

// 【セキュリティチェック】session が null であることを確認
// session が存在する場合、Supabase設定でメール確認が無効になっている可能性がある
if (authData.session) {
  console.error('[Invite Signup] SECURITY WARNING: Session was returned immediately after signup.', {
    message: 'Supabase "Confirm email" setting may be disabled. Email ownership verification is required for security.'
  });
  return fail(500, {
    error: 'システム設定エラー: メール確認が必要です。管理者に連絡してください。'
  });
}

// メール確認画面にリダイレクト
throw redirect(303, `/invite/${token}/check-email`);
```

**Email Confirmation Flow:**
1. ユーザーがサインアップフォームを送信
2. 通常の`signUp()`でアカウント作成
   - Supabase設定 "Confirm email" が有効な場合、`session` は `null` となる
   - アプリケーションレベルで `session` が `null` であることを検証（設定ミス検出）
3. メール確認リンクを送信
4. ユーザーがメールリンクをクリック
5. `/auth/callback?next=/invite/${token}/complete`にリダイレクト
6. `/invite/${token}/complete`で組織メンバー追加処理を実行
7. 組織ページにリダイレクト

**Why**:
- メール所有の確認は必須のセキュリティ対策
- 招待制であっても、メールアドレスの所有を証明する必要がある
- `admin.createUser({ email_confirm: true })`は管理者による手動アカウント作成用であり、ユーザー自身のサインアップには不適切
- 通常のサインアップフローに寄せることで、セキュリティと一貫性が向上
- **重要**: `session` が存在する場合は設定ミスの可能性があるため、アプリケーションレベルで検証が必須

**Common Mistakes**:
- ❌ `admin.createUser({ email_confirm: true })` を使用する（メール所有確認をスキップ）
- ❌ `signUp()` の戻り値で `session` の有無をチェックしない（Supabase設定に盲目的に依存）
- ❌ メール比較で正規化を行わない（大文字小文字、空白による回避のリスク）
- ❌ 正規化比較後に未正規化メールを `signUp()` に渡す（データ整合性の問題）
- ❌ メール確認フローのテストを書かない
- ✅ 正しいパターン:
  - 通常の `signUp()` を使用
  - `session === null` を検証（メール確認必須を保証）
  - メール比較時は必ず正規化
  - **`signUp()` には正規化後のメールを渡す**
  - 設定ミス時のエラーを返す

**Email Normalization (IMPORTANT):**
- メール比較時は必ず正規化する（大文字小文字、空白対応）
- `normalizeEmail(email)` で `.trim().toLowerCase()` を実施
- 理由: `User@Example.com` と `user@example.com` は同一メールアドレスとして扱うべき
- **重要**: 正規化後のメールアドレスを `signUp()` に渡す
  - 比較だけでなく、実際に使用するメールも正規化する
  - `" invited@example.com "` のような空白付きメールがSupabaseに保存されることを防ぐ
- 適用箇所:
  - サインアップ時の招待メールとの照合
  - **`signUp()` 呼び出し時（正規化後のメールを使用）** ← NEW
  - メール確認後（completeページ）の再検証

**Security Impact**: CRITICAL - メール所有確認なしでは、攻撃者が他人のメールアドレスで組織に参加可能

**Test Coverage**: 必須 - メール確認フローは必ずテストで保護すること
- メール一致/不一致のテスト
- 大文字小文字の違いのテスト
- 前後の空白のテスト
- **session 存在時のテスト（設定ミス検出）** ← NEW

**Affected Files**:
- `/src/routes/invite/[token]/+page.server.ts` (signup action)
- `/src/routes/invite/[token]/check-email/+page.svelte` (メール確認画面)
- `/src/routes/invite/[token]/complete/+page.server.ts` (メール確認後の処理)
- `/src/routes/invite/[token]/invite.test.ts` (テスト - 12テストケース)

---

### ✅ Auth Flow Consistency (SECURITY & MAINTAINABILITY)
**Rule**: サインアップ、招待サインアップ、ログインは同じセキュリティパターンを使用し、一貫性を保つ

**Key Principles:**
1. **Email Normalization**: すべてのフローで `normalizeEmail()` を使用
2. **Error Code-Based Detection**: 文字列マッチングではなく `error.code` で判定
3. **Session Null Check**: `signUp()` 後に `session === null` を検証（サインアップのみ）
4. **Normalized Email in Auth Calls**: 正規化後のメールを `signUp()` / `signInWithPassword()` に渡す

**Implementation Pattern - Signup:**
```typescript
// メール正規化関数（すべてのフローで共通）
function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

// バリデーション後、正規化したメールを作成
const normalizedEmail = normalizeEmail(email);

// サインアップ（正規化後のメールを使用）
const { data: authData, error: authError } = await supabase.auth.signUp({
  email: normalizedEmail,  // ← 正規化後のメールを使用
  password,
  options: {
    data: { full_name: fullName },
    emailRedirectTo: '...'
  }
});

// エラーコードベースの判定（サインアップ）
if (authError) {
  if (authError.code === 'user_already_exists' ||
      authError.code === 'email_exists') {
    return fail(409, { error: '既存ユーザーエラー' });
  }

  if (authError.code === 'over_email_send_rate_limit' ||
      (authError as any).status === 429) {
    return fail(429, { error: 'レート制限エラー' });
  }

  // その他のエラーコードをログ出力
  console.error('Unexpected error code:', authError.code);
  return fail(500, { error: 'サーバーエラー' });
}

// 既存ユーザー検出（identitiesが空）
if (authData.user && Array.isArray(authData.user.identities) &&
    authData.user.identities.length === 0) {
  return fail(409, { error: '既存ユーザーエラー' });
}

// セキュリティチェック: session が null であることを確認
if (authData.session) {
  console.error('SECURITY WARNING: Session was returned immediately after signup.');
  return fail(500, {
    error: 'システム設定エラー: メール確認が必要です。管理者に連絡してください。'
  });
}

// 成功: メール確認画面へリダイレクト
throw redirect(303, '/signup/success');
```

**Implementation Pattern - Login:**
```typescript
// メール正規化関数（サインアップと同じ）
function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

// ログイン時に正規化を適用
const normalizedEmail = normalizeEmail(email);

const { error } = await supabase.auth.signInWithPassword({
  email: normalizedEmail,  // ← 正規化後のメールを使用
  password
});

// エラーコードベースの判定（ログイン）
if (error) {
  console.error('[login] signIn error:', {
    code: error.code,
    message: error.message,
    status: (error as any).status
  });

  // 無効な認証情報
  if (error.code === 'invalid_credentials') {
    throw new Error('メールアドレスまたはパスワードが正しくありません。');
  }

  // メール未確認
  if (error.code === 'email_not_confirmed') {
    throw new Error('メールアドレスが確認されていません。確認メールをご確認ください。');
  }

  // レート制限
  if (error.code === 'too_many_requests' || (error as any).status === 429) {
    throw new Error('ログイン試行回数が上限に達しました。しばらく待ってから再度お試しください。');
  }

  // その他の予期しないエラー
  console.error('[login] Unexpected error code:', error.code);
  throw new Error('ログインに失敗しました。再度お試しください。');
}

// 成功: ダッシュボードへリダイレクト
await goto('/dashboard');
```

**Why Consistency Matters:**
- **セキュリティ**: すべてのフローで同じセキュリティチェックを適用
- **保守性**: パターンが統一されていると、バグ修正や改善が容易
- **ユーザー体験**: 一貫したエラーメッセージとメール処理
- **テスト**: 同じテストパターンをすべてのフローに適用可能
- **信頼性**: 一方のフローで見つかった問題は他方にも適用される

**Common Mistakes**:
- ❌ 一部のフローだけにセキュリティ改善を適用し、他を忘れる
- ❌ サインアップでは正規化するが、ログインでは正規化しない
- ❌ サインアップではエラーコードベース、ログインでは文字列マッチング
- ❌ session チェックをサインアップの一方のフローだけに実装
- ❌ ログインでSupabaseのデフォルトエラーメッセージをそのまま表示
- ✅ 正しいパターン:
  - すべてのフローで同じヘルパー関数を使用（または同じ実装を使用）
  - セキュリティ改善は必ずすべてのフローに適用
  - テストパターンもすべてのフローで統一
  - エラーコードベースの判定で適切なメッセージを返す

**Affected Files**:
- `/src/routes/signup/+page.server.ts` (通常のサインアップ - サーバーサイド)
- `/src/routes/invite/[token]/+page.server.ts` (招待サインアップ - サーバーサイド)
- `/src/routes/login/+page.svelte` (ログイン - クライアントサイド)
- `/src/routes/signup/signup.test.ts` (通常のサインアップテスト - 7テスト)
- `/src/routes/invite/[token]/invite.test.ts` (招待サインアップテスト - 12テスト)
- `/src/routes/login/login.test.ts` (ログインテスト - 14テスト)

---

### ✅ Invitation Completion Race Condition Handling (RELIABILITY)
**Rule**: 招待完了処理では一意制約違反（PostgreSQL error code: 23505）を成功として扱い、冪等性を確保する

**Problem**:
招待完了処理（`/invite/[token]/complete`）で、`existingMembership` チェック後に `insert` する際、同時アクセス時に一意制約違反が起きると 500 エラーになる。本来は「既に参加済み」として成功扱いが望ましい。

**Wrong (非冪等な実装):**
```typescript
// すでにメンバーかチェック
const { data: existingMembership } = await supabaseAdmin
  .from('organization_members')
  .select('id')
  .eq('organization_id', invitation.organization_id)
  .eq('user_id', user.id)
  .is('removed_at', null)
  .single();

if (existingMembership) {
  throw redirect(303, `/organization/${invitation.organization_id}`);
}

// 組織メンバーとして追加
const { error: memberError } = await supabaseAdmin
  .from('organization_members')
  .insert({
    organization_id: invitation.organization_id,
    user_id: user.id,
    role: invitation.role
  });

if (memberError) {
  // ❌ すべてのエラーを500として扱う（一意制約違反も含む）
  console.error('[Invite Complete] Error adding member:', memberError);
  throw error(500, '組織への追加に失敗しました');
}
```

**Correct (冪等な実装):**
```typescript
// すでにメンバーかチェック
const { data: existingMembership } = await supabaseAdmin
  .from('organization_members')
  .select('id')
  .eq('organization_id', invitation.organization_id)
  .eq('user_id', user.id)
  .is('removed_at', null)
  .single();

if (existingMembership) {
  throw redirect(303, `/organization/${invitation.organization_id}`);
}

// 組織メンバーとして追加
const { error: memberError } = await supabaseAdmin
  .from('organization_members')
  .insert({
    organization_id: invitation.organization_id,
    user_id: user.id,
    role: invitation.role
  });

if (memberError) {
  // ✅ PostgreSQLエラーコード '23505' は一意制約違反（UNIQUE constraint violation）
  // 同時アクセスでexistingMembershipチェック後にinsertが競合した場合に発生
  // この場合、既に参加済みとして成功扱いし、組織ページにリダイレクト
  if (memberError.code === '23505') {
    console.log('[Invite Complete] User is already a member (race condition detected), redirecting to organization');
    throw redirect(303, `/organization/${invitation.organization_id}`);
  }

  // その他の予期しないエラー
  console.error('[Invite Complete] Error adding member:', {
    code: memberError.code,
    message: memberError.message,
    details: memberError
  });
  throw error(500, '組織への追加に失敗しました');
}
```

**Apply to All Insert Operations**:
同じパターンをプロフィール作成と招待使用履歴記録にも適用:

```typescript
// プロフィール作成時の一意制約違反を成功として扱う
if (profileError) {
  if (profileError.code === '23505') {
    console.log('[Invite Complete] Profile already exists (race condition detected), continuing');
  } else {
    console.error('[Invite Complete] Error creating profile:', {
      code: profileError.code,
      message: profileError.message,
      details: profileError
    });
  }
}

// 招待使用履歴記録時の一意制約違反を成功として扱う
if (usageError) {
  if (usageError.code === '23505') {
    console.log('[Invite Complete] Invitation usage already recorded (race condition detected)');
  } else {
    console.error('[Invite Complete] Error recording invitation usage:', {
      code: usageError.code,
      message: usageError.message,
      details: usageError
    });
  }
}
```

**Why**:
- **冪等性**: 同じ招待リンクを複数回（同時に）使用しても、最終的に同じ結果（メンバー追加成功）となる
- **ユーザー体験**: 競合時に500エラーではなく、成功として扱われる
- **信頼性**: ネットワーク遅延やリトライなどで同時アクセスが発生しても、正しく処理される
- **PostgreSQL error code 23505**: `unique_violation` を示す標準的なエラーコード

**Test Coverage**: 4テストケース
1. 組織メンバー追加時の一意制約違反（23505）を成功として扱う
2. プロフィール作成時の一意制約違反（23505）を成功として扱う
3. 招待使用履歴記録時の一意制約違反（23505）を成功として扱う
4. メンバー追加時の予期しないエラー（非23505）は500エラーを返す

**Common Mistakes**:
- ❌ すべてのデータベースエラーを500として扱う
- ❌ 一意制約違反を検出せずにエラーとして扱う
- ❌ エラーコードを確認せずに `error.message.includes()` で判定する
- ❌ 競合が発生しない前提でコードを書く（楽観的ロックなし）
- ✅ 正しいパターン:
  - PostgreSQLエラーコード '23505' を検出
  - 一意制約違反は成功同等として扱う
  - その他のエラーは詳細をログ出力して500エラー
  - すべてのinsert操作に一貫して適用

**Alternative Approach**:
DB関数で原子的に処理する方法もあるが、現在の実装ではエラーコードベースの判定で十分：
```sql
CREATE OR REPLACE FUNCTION add_organization_member_idempotent(
  p_organization_id uuid,
  p_user_id uuid,
  p_role text
)
RETURNS void AS $$
BEGIN
  INSERT INTO organization_members (organization_id, user_id, role)
  VALUES (p_organization_id, p_user_id, p_role)
  ON CONFLICT (organization_id, user_id) DO NOTHING;
END;
$$ LANGUAGE plpgsql;
```

**Affected Files**:
- `/src/routes/invite/[token]/complete/+page.server.ts` (メール確認後の組織メンバー追加処理)
- `/src/routes/invite/[token]/complete/complete.test.ts` (競合処理テスト - 4テスト)

---

## Organization & Plan Management

### ✅ Dynamic Organization URLs
**Rule**: 組織固有のURLは必ず動的な`organizationId`を使用する

**Wrong:**
```typescript
return {
  allowed: false,
  upgradeUrl: '/settings/billing'  // 存在しないパス
};
```

**Correct:**
```typescript
return {
  allowed: false,
  upgradeUrl: `/organization/${organizationId}/change-plan`
};
```

**Why**: 組織ベースのアーキテクチャでは、プラン管理も組織単位。ハードコードされたパスは500エラーの原因となる。

**Affected Files**:
- `/src/lib/server/organizationLimits.ts` (全6つの制限チェック関数)

---

### ✅ Plan Limit Checks
**Rule**: 組織の機能制限チェックは`organizationLimits.ts`のヘルパー関数を使用する

**Available Functions:**
- `checkCanCreateSession(supabase, organizationId)`
- `checkCanAddMember(supabase, organizationId)`
- `checkCanUseTournamentMode(supabase, organizationId)`
- `checkCanUseTrainingMode(supabase, organizationId)`
- `checkCanAddJudgeToSession(supabase, sessionId)`
- `checkCanUseScoreboard(supabase, organizationId)`

**Pattern:**
```typescript
const { allowed, reason, upgradeUrl } = await checkCanCreateSession(supabase, organizationId);

if (!allowed) {
  return fail(403, { error: reason, upgradeUrl });
}
```

---

## Training Mode vs Tournament Mode

### ✅ Mode Detection
**Rule**: モード判定は`isTrainingMode`変数で統一する

**Pattern:**
```typescript
const isTrainingMode = modeType === 'training' || sessionDetails.mode === 'training';

// モードに応じた処理
if (isTrainingMode) {
  // 研修モード特有の処理
} else {
  // 大会モード特有の処理
}
```

**Why**: モード判定が分散すると、バグの原因となる。一箇所で判定して変数に格納することで一貫性を保つ。

---

### ✅ Multi-Judge Mode Detection
**Rule**: 複数検定員モードの判定は、モードによって取得元が異なる

**Pattern:**
```typescript
let isMultiJudge = false;

if (isTrainingMode) {
  // 研修モード: training_sessionsから取得
  const { data: trainingSession } = await supabase
    .from('training_sessions')
    .select('is_multi_judge')
    .eq('session_id', sessionId)
    .maybeSingle();
  isMultiJudge = trainingSession?.is_multi_judge || false;
} else {
  // 大会モード: 常にtrue（または sessionsテーブルから取得）
  isMultiJudge = true;
}
```

**Why**: 研修モードと大会モードで設定の保存場所が異なる。

**Affected Files**:
- `/src/routes/session/[id]/score/[modeType]/[eventId]/complete/+page.server.ts`
- `/src/routes/session/[id]/score/[modeType]/[eventId]/input/+page.server.ts`

---

### ✅ Score Calculation
**Rule**: スコア計算方法はモードによって異なる

**Training Mode (研修モード):**
- 平均点を計算: `sum / scores.length`
- 全検定員の得点の算術平均

**Tournament Mode (大会モード):**
- 合計点を計算
- 3審3採: 全員の合計
- 5審3採 (`exclude_extremes=true`): 最高・最低を除外した3人の合計

**Pattern:**
```typescript
if (isTrainingMode) {
  // 平均点
  const sum = scores.reduce((acc, s) => acc + parseFloat(s.score), 0);
  displayScore = parseFloat((sum / scores.length).toFixed(2));
} else {
  // 合計点（3審3採 or 5審3採）
  const sortedScores = [...scores].map(s => parseFloat(s.score)).sort((a, b) => a - b);
  if (sessionDetails.exclude_extremes && sortedScores.length >= 5) {
    const middleScores = sortedScores.slice(1, -1);
    displayScore = parseFloat(middleScores.reduce((acc, s) => acc + s, 0).toFixed(2));
  } else {
    displayScore = parseFloat(sortedScores.reduce((acc, s) => acc + s, 0).toFixed(2));
  }
}
```

---

## Testing Patterns

### ✅ URL Encoding in Tests
**Rule**: リダイレクトURLのエラーメッセージをテストする際は、URL encodingを考慮する

**Pattern:**
```typescript
try {
  await GET({ url: mockUrl, locals: mockLocals } as any);
  expect.fail('Expected redirect to be thrown');
} catch (err: any) {
  expect(isRedirect(err)).toBe(true);
  expect(err.location).toContain('/login?error=');

  // URL-encoded error message should be decoded
  const decodedLocation = decodeURIComponent(err.location);
  expect(decodedLocation).toContain('認証リンクが既に使用済みか無効です');
}
```

**Why**: `redirect()`で日本語エラーメッセージを含むURLを生成すると、自動的にURL encodingされる。テストでは`decodeURIComponent()`を使用して比較する。

**Affected Files**:
- `/src/routes/auth/callback/callback.test.ts`

---

## Database & RLS

### ⚠️ RLS Infinite Recursion
**Rule**: RLSポリシーで他のテーブルを参照する際は、無限再帰に注意する

**Common Issue:**
- `organization_members`のRLSが`organizations`を参照
- `organizations`のRLSが`organization_members`を参照
- → 無限再帰が発生

**Solution:**
- `SECURITY DEFINER`関数を使用してRLSをバイパス
- または、ポリシーの依存関係を一方向にする

**Note**: このプロジェクトでは過去に複数回この問題に遭遇している。RLS変更時は必ず循環参照をチェックすること。

---

## Guest User Patterns

### ✅ Guest Authentication
**Rule**: ゲストユーザーは`guest_identifier`で識別し、通常ユーザーとは別の認証フローを使用

**Pattern:**
```typescript
const guestIdentifier = url.searchParams.get('guest');

if (guestIdentifier) {
  // ゲストユーザーの認証
  const { data: guestParticipant } = await supabase
    .from('session_participants')
    .select('*')
    .eq('guest_identifier', guestIdentifier)
    .eq('session_id', sessionId)
    .single();

  if (!guestParticipant) {
    throw error(403, 'アクセス権限がありません');
  }
} else {
  // 通常ユーザーの認証
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    throw redirect(303, '/login');
  }
}
```

---

## Common Mistakes to Avoid

1. **Never** use `err?.status === 303` to detect redirects → Use `isRedirect(err)`
2. **Never** use `error.message.includes()` for auth error handling → Use `error.code` **SECURITY & RELIABILITY**
3. **Never** expose internal error messages to users → Use fixed user-facing messages **SECURITY**
4. **Never** hardcode `/settings/billing` → Use `/organization/${organizationId}/change-plan`
5. **Never** assume Supabase returns errors for existing users → Check `identities.length === 0`
5. **Never** forget to decode URL-encoded error messages in tests
6. **Never** mix training mode and tournament mode data sources without checking `isTrainingMode`
7. **Never** use `admin.createUser({ email_confirm: true })` for user-initiated signups → Use normal `signUp()` with email confirmation **CRITICAL SECURITY**
8. **Always** check for RLS circular dependencies when modifying policies
9. **Always** support both authenticated and guest users in session-related pages
10. **Always** validate `next` parameter with strict patterns (UUID v4 for organization paths) to prevent open redirect and path traversal attacks **CRITICAL SECURITY**
11. **Always** validate invitation email matches input email when creating pre-confirmed users
12. **Always** use specific error codes instead of broad string matching for better reliability
13. **Never** use loose regex patterns like `[a-f0-9-]+` for UUID validation → Use strict UUID v4 format
14. **Always** validate `session === null` after `signUp()` to detect Supabase configuration errors **CRITICAL SECURITY**
15. **Always** normalize emails before passing to `signUp()` and `signInWithPassword()`, not just for comparison **DATA INTEGRITY**
16. **Always** apply security improvements to all auth flows (signup, invitation signup, login) **CONSISTENCY & SECURITY**
17. **Never** use generic error messages for login → Use error code-based messages (invalid_credentials, email_not_confirmed, too_many_requests) **USER EXPERIENCE**
18. **Always** add message fallback when using error code-based detection → Prevents 500 errors when Supabase doesn't set error.code **RELIABILITY**
19. **Always** handle PostgreSQL unique constraint violations (error code 23505) as success in idempotent operations → Prevents 500 errors on race conditions **RELIABILITY**

---

## File Location Guide

### Authentication
- Signup: `/src/routes/signup/+page.server.ts`
- Login: `/src/routes/login/+page.svelte` (client-side)
- Auth Callback: `/src/routes/auth/callback/+server.ts`

### Organization Management
- Limits: `/src/lib/server/organizationLimits.ts`
- Creation: `/src/routes/onboarding/create-organization/+page.server.ts`

### Session & Scoring
- Session Detail: `/src/routes/session/[id]/+page.svelte`
- Bib Input: `/src/routes/session/[id]/score/[modeType]/[eventId]/+page.svelte`
- Score Input: `/src/routes/session/[id]/score/[modeType]/[eventId]/input/+page.svelte`
- Score Complete: `/src/routes/session/[id]/score/[modeType]/[eventId]/complete/+page.svelte`
- Results: `/src/routes/session/[id]/score/[modeType]/[eventId]/results/+page.svelte`

### Stripe Integration
- Checkout: `/src/routes/api/stripe/create-checkout-session/+server.ts`
- Portal: `/src/routes/api/stripe/create-portal-session/+server.ts`
- Org Checkout: `/src/routes/api/stripe/create-organization-checkout/+server.ts`

---

## Update History

- 2026-03-03 (Session 2): Added auth error code-based handling, invitation email confirmation security patterns, and URL parameter validation (UUID v4) patterns
- 2026-03-03 (Session 1): Initial creation with SvelteKit redirect/error patterns, Supabase patterns, organization management, mode detection, and testing patterns
