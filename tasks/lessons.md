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

**Common Supabase Auth Error Codes:**
- `invalid_grant`: コードが無効、期限切れ、または既に使用済み
- `otp_expired`: OTP/コードが期限切れ
- `validation_failed`: バリデーションエラー
- `provider_email_needs_verification`: メール確認が必要

**Why**:
- エラーコードは安定したAPI仕様の一部
- 文字列マッチングは広すぎて誤判定のリスクがある
- メッセージ文言の変更や多言語化に対応できる
- 意図しないエラーを捕捉しない

**Affected Files**:
- `/src/routes/auth/callback/+server.ts`
- `/src/routes/auth/callback/callback.test.ts`

**References**:
- [Supabase Auth Error Codes](https://supabase.com/docs/reference/javascript/auth-error-codes)

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
// 招待情報を取得
const { data: invitation } = await supabaseAdmin
  .from('invitations')
  .select('*')
  .eq('token', token)
  .single();

// ✅ 招待メールが指定されている場合、入力メールと一致するかチェック
if (invitation.email && invitation.email !== email) {
  return fail(403, {
    error: 'この招待は別のメールアドレス宛です。招待されたメールアドレスを使用してください。'
  });
}

// ✅ 通常のサインアップフローを使用（メール確認必須）
const { data: authData, error: authError } = await locals.supabase.auth.signUp({
  email,
  password,
  options: {
    data: {
      full_name: fullName,
      invitation_token: token  // メール確認後に使用
    },
    emailRedirectTo: `${PUBLIC_SITE_URL}/auth/callback?next=/invite/${token}/complete`
  }
});

// メール確認画面にリダイレクト
throw redirect(303, `/invite/${token}/check-email`);
```

**Email Confirmation Flow:**
1. ユーザーがサインアップフォームを送信
2. 通常の`signUp()`でアカウント作成（`email_confirm: false`がデフォルト）
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

**Security Impact**: CRITICAL - メール所有確認なしでは、攻撃者が他人のメールアドレスで組織に参加可能

**Test Coverage**: 必須 - メール確認フローは必ずテストで保護すること

**Affected Files**:
- `/src/routes/invite/[token]/+page.server.ts` (signup action)
- `/src/routes/invite/[token]/check-email/+page.svelte` (メール確認画面)
- `/src/routes/invite/[token]/complete/+page.server.ts` (メール確認後の処理)
- `/src/routes/invite/[token]/invite.test.ts` (テスト)

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
3. **Never** hardcode `/settings/billing` → Use `/organization/${organizationId}/change-plan`
4. **Never** assume Supabase returns errors for existing users → Check `identities.length === 0`
5. **Never** forget to decode URL-encoded error messages in tests
6. **Never** mix training mode and tournament mode data sources without checking `isTrainingMode`
7. **Never** use `admin.createUser({ email_confirm: true })` for user-initiated signups → Use normal `signUp()` with email confirmation **CRITICAL SECURITY**
8. **Always** check for RLS circular dependencies when modifying policies
9. **Always** support both authenticated and guest users in session-related pages
10. **Always** validate `next` parameter with strict patterns (UUID v4 for organization paths) to prevent open redirect and path traversal attacks **CRITICAL SECURITY**
11. **Always** validate invitation email matches input email when creating pre-confirmed users
12. **Always** use specific error codes instead of broad string matching for better reliability
13. **Never** use loose regex patterns like `[a-f0-9-]+` for UUID validation → Use strict UUID v4 format

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
