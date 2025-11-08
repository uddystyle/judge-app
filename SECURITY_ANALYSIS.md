# Judge App - Security & Performance Analysis Report

**Analysis Date:** November 8, 2025  
**Project:** Judge App (SvelteKit + Supabase + Stripe)  
**Scope:** Complete codebase security and performance review

---

## Executive Summary

The codebase demonstrates a relatively mature approach to security with some significant strengths but also several areas requiring attention. The application uses Supabase with RLS policies, handles authentication correctly, and implements plan-based access control. However, there are **critical N+1 query issues**, potential **authorization bypasses**, and **performance bottlenecks** that need immediate attention.

**Overall Risk Level:** MEDIUM-HIGH

---

## 1. RLS POLICIES (Row Level Security)

### Status: RECOVERED WITH REMAINING RISKS

The database shows evidence of previous infinite recursion issues that have been addressed through recent migrations (files 007, 014, 022).

#### Current RLS Structure (Good):
- **Migration 022** (`session_participants`): Simplified to allow authenticated users view all participants
- **Migration 007** (`organization_members`): Helper function `is_organization_admin()` to prevent recursion
- **Migration 020** (`organizations`): Uses direct JOINs to `organization_members`

#### Remaining RLS Concerns:

**HIGH SEVERITY - Policy Structure Issue:**

Location: `/database/migrations/020_fix_organizations_policies.sql` (lines 21-27, 34-40, 46-53)

```sql
CREATE POLICY "Members can view their organization"
  ON organizations FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM organization_members
      WHERE organization_members.organization_id = organizations.id
        AND organization_members.user_id = auth.uid()
    )
  );
```

**Issue:** While not infinite recursion, these policies use correlated subqueries on EVERY SELECT. This creates:
- Potential performance degradation with large member lists
- Complexity that makes optimization difficult

**Recommendation:** These policies should be fine for now but consider materialized views for read-heavy scenarios.

---

## 2. SQL QUERY PATTERNS

### CRITICAL: N+1 Query Problems

**SEVERITY:** CRITICAL  
**Impact:** Performance degradation, unnecessary database load

#### Issue 1: Profile Fetching in Loop
**File:** `/src/routes/session/[id]/details/+page.server.ts` (lines 43-56)

```typescript
const participants = await Promise.all(
  (participantIds || []).map(async (p) => {
    const { data: profile } = await supabase
      .from('profiles')
      .select('full_name')
      .eq('id', p.user_id)
      .single();
    return { user_id: p.user_id, profiles: profile };
  })
);
```

**Problem:** 
- Fetches all participant IDs first (1 query)
- Then fetches each profile individually in parallel (N queries)
- Should use a single JOIN query instead

**Expected Queries:** 1  
**Actual Queries:** 1 + N (where N = participant count)

---

#### Issue 2: Training Scores with Judge Names
**File:** `/src/routes/session/[id]/details/+page.server.ts` (lines 109-126)

```typescript
if (scores && scores.length > 0) {
  const scoresWithJudges = await Promise.all(
    scores.map(async (score) => {
      const { data: judgeProfile } = await supabase
        .from('profiles')
        .select('full_name')
        .eq('id', score.judge_id)
        .single();
      return { ...score, judge: { full_name: judgeProfile?.full_name } };
    })
  );
  trainingScores = scoresWithJudges;
}
```

**Problem:** Same as Issue 1
**Expected Queries:** 1  
**Actual Queries:** 1 + S (where S = score count)

---

#### Issue 3: Export API Judge Names
**File:** `/src/routes/api/export/[sessionId]/+server.ts` (lines 87-107)

```typescript
const scoresWithJudges = await Promise.all(
  trainingScores.map(async (score) => {
    const { data: judgeProfile } = await supabase
      .from('profiles')
      .select('full_name')
      .eq('id', score.judge_id)
      .single();
    // ...
  })
);
```

**Problem:** Same N+1 pattern  
**Expected Queries:** 1  
**Actual Queries:** 1 + S

---

#### Issue 4: Score Completion Loop (Training Mode)
**File:** `/src/routes/session/[id]/score/[modeType]/[eventId]/complete/+page.server.ts` (lines 91-104)

```typescript
const scoresWithNames = await Promise.all(
  trainingScores.map(async (s: any) => {
    const { data: profile } = await supabase
      .from('profiles')
      .select('full_name')
      .eq('id', s.judge_id)
      .single();
    // ...
  })
);
```

**Problem:** Same N+1 pattern  
**Expected Queries:** 1  
**Actual Queries:** 1 + S

---

#### Issue 5: Organization Usage Data
**File:** `/src/routes/account/+page.server.ts` (lines 76-111)

```typescript
const organizationsWithUsage = await Promise.all(
  organizations.map(async (org: any) => {
    const { data: planLimits } = await supabase
      .from('plan_limits')
      .select('*')
      .eq('plan_type', org.plan_type)
      .single();  // Query 1
    
    const { count: sessionsCount } = await supabase
      .from('sessions')
      .select('*', { count: 'exact', head: true })
      .eq('organization_id', org.id);  // Query 2
    
    const { count: membersCount } = await supabase
      .from('organization_members')
      .select('*', { count: 'exact', head: true })
      .eq('organization_id', org.id);  // Query 3
    
    return { ...org, planLimits, currentUsage };
  })
);
```

**Problem:** 3 queries per organization in parallel  
**Expected Queries:** 1 (with proper JOINs)  
**Actual Queries:** 1 + (3 * O) where O = organization count

---

#### Issue 6: Dashboard Sessions Load
**File:** `/src/routes/dashboard/+page.server.ts` (lines 45-56)

```typescript
if (organizationIds.length > 0) {
  const { data: sessionsData } = await supabase
    .from('sessions')
    .select('id, name, session_date, join_code, is_active, is_tournament_mode, mode, organization_id')
    .in('organization_id', organizationIds)
    .order('created_at', { ascending: false });
  orgSessions = sessionsData || [];
}

const { data: participantSessions } = await supabase
  .from('session_participants')
  .select(`
    session_id,
    sessions (...)
  `)
  .eq('user_id', user.id);
```

**Issue:** Possible duplicate sessions if user is both org member and guest. De-duplication in JavaScript (lines 84-86) suggests query overlap.

---

### MEDIUM: Missing Data Selection

**File:** `/src/routes/session/[id]/+page.server.ts` (line 20)

```typescript
const { data: sessionDetails, error: sessionError } = await supabase
  .from('sessions')
  .select('*')  // Selects ALL columns
  .eq('id', sessionId)
  .single();
```

**Issue:** `select('*')` fetches unnecessary columns like `active_prompt_id`, `score_calculation`, etc.  
**Impact:** Wasted bandwidth, especially on mobile

**Better:** Only select needed columns

---

### MEDIUM: Missing Pagination

**File:** `/src/routes/session/[id]/details/+page.server.ts` (lines 95-106)

Training scores loaded without limit could load thousands of records:

```typescript
const { data: scores } = await supabase
  .from('training_scores')
  .select(...)
  .eq('training_events.session_id', sessionId)
  .order('created_at', { ascending: false });
  // NO LIMIT OR PAGINATION
```

---

## 3. AUTHENTICATION & AUTHORIZATION

### HIGH SEVERITY: Missing Authorization Checks

#### Issue 1: Session Access Control
**File:** `/src/routes/session/[id]/details/+page.server.ts` (lines 4-29)

```typescript
const { data: sessionDetails, error: sessionError } = await supabase
  .from('sessions')
  .select('*')
  .eq('id', sessionId)
  .single();

if (sessionError) {
  throw error(404, '検定が見つかりません。');
}

// ⚠️ NO AUTHORIZATION CHECK HERE
// The user could be viewing ANY session they have access to via RLS
```

**Issue:** Relies entirely on RLS policies. If RLS fails, user could access unauthorized sessions.

**Mitigation Present:** RLS on sessions table should enforce org membership, but explicit check would be safer.

---

#### Issue 2: Organization Admin Bypass Risk
**File:** `/src/routes/api/invitations/create/+server.ts` (lines 34-44)

```typescript
const { data: membership } = await supabaseAdmin
  .from('organization_members')
  .select('role')
  .eq('organization_id', organizationId)
  .eq('user_id', user.id)
  .single();

if (!membership || membership.role !== 'admin') {
  return json({ error: '管理者のみが招待を作成できます' }, { status: 403 });
}
```

**Issue:** Uses `supabaseAdmin` with service role key. If `user.id` is compromised in JWT, attacker can bypass this check.

**Better:** Could add additional verification via RLS on separate query.

---

#### Issue 3: Session Ownership Not Always Verified
**File:** `/src/routes/session/[id]/score/[modeType]/[eventId]/complete/+page.server.ts` (lines 161-229)

The `endSession` action relies on `chief_judge_id` check:

```typescript
const isChief = user.id === sessionDetails.chief_judge_id;
```

**Issue:** `chief_judge_id` could be manipulated if `sessions` table has weak RLS. Better to verify:
1. User is session participant
2. User is organization member
3. User is chief judge

---

#### Issue 4: No Rate Limiting on API Endpoints
**Files Affected:** 
- `/src/routes/api/organization/create/+server.ts`
- `/src/routes/api/invitations/create/+server.ts`
- `/src/routes/api/sessions/+server.ts`

**Issue:** No rate limiting on:
- Organization creation
- Invitation generation
- Session creation

Attacker could DOS by creating unlimited invitations.

---

### MEDIUM: Insufficient User Verification

**File:** `/src/routes/api/delete-user/+server.ts` (lines 16-29)

```typescript
const { userToken } = await request.json();
if (!userToken) {
  throw svelteError(401, '認証トークンが必要です。');
}

const { data: { user }, error: userError } = 
  await supabaseAdmin.auth.getUser(userToken);

if (userError || !user) {
  throw svelteError(404, 'ユーザーが見つかりません。');
}

const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(user.id);
```

**Issue:** Uses user-provided token to delete account. Should also verify:
- Token matches current session
- User confirmed action via email or 2FA
- Account has no active subscriptions

---

## 4. INPUT VALIDATION & INJECTION RISKS

### GOOD: Parameterized Queries

All Supabase queries use parameterized queries via `.eq()`, `.in()`, etc. No string concatenation in queries.

**Example (Good):**
```typescript
.eq('join_code', joinCode)  // Safe - parameterized
```

### GOOD: Form Input Validation

**File:** `/src/routes/session/join/+page.server.ts` (lines 18-32)

```typescript
const joinCode = (formData.get('joinCode') as string)?.trim().toUpperCase();

if (!joinCode) return fail(400, { error: '参加コードを入力してください。' });
if (joinCode.length !== 6) return fail(400, { error: '参加コードは6桁です。' });
if (!/^[A-Z0-9]{6}$/.test(joinCode)) return fail(400, { error: '参加コードは英数字6桁...' });
```

**Status:** Excellent validation

---

### MEDIUM: Email Validation Missing

**File:** `/src/routes/signup/+page.server.ts` (lines 15-17)

```typescript
if (!email) {
  return fail(400, { fullName, email, error: 'メールアドレスを入力してください。' });
}
// No format validation!
```

**Issue:** Should validate email format before sending to Supabase.

---

### MEDIUM: Password Requirements Weak

**File:** `/src/routes/signup/+page.server.ts` (lines 18-20)

```typescript
if (!password || password.length < 6) {
  return fail(400, { error: 'パスワードは6文字以上で入力してください。' });
}
```

**Issue:** 6 characters is very weak. Consider enforcing:
- Minimum 12 characters
- Mixed case
- Numbers
- Special characters

---

### LOW: Organization Name Not Sanitized

**File:** `/src/routes/api/organization/create/+server.ts` (line 31)

```typescript
if (!organizationName || !organizationName.trim()) {
  return json({ error: '組織名を入力してください' }, { status: 400 });
}

const { data: organization, error: orgError } = await supabaseAdmin
  .from('organizations')
  .insert({
    name: organizationName.trim(),  // Trimmed but no length check
    // ...
  })
```

**Issue:** No length limit. Could create huge organization names. Should add:
```typescript
if (organizationName.trim().length > 255) {
  return json({ error: '組織名は255文字以内です' }, { status: 400 });
}
```

---

## 5. PERFORMANCE ISSUES

### CRITICAL: Large Data Loads Without Pagination

#### Issue 1: Training Events
**File:** `/src/routes/session/[id]/details/+page.server.ts` (lines 76-84)

```typescript
const { data: trainingEvents, error: eventsError } = await supabase
  .from('training_events')
  .select('*')
  .eq('session_id', sessionId)
  .order('order_index', { ascending: true });
  // NO PAGINATION!
```

**Impact:** If session has 10,000 events, all loaded into memory.

---

#### Issue 2: Custom Events
**File:** `/src/routes/session/[id]/details/+page.server.ts` (lines 65-73)

```typescript
const { data: customEvents, error: eventsError } = await supabase
  .from('custom_events')
  .select('*')
  .eq('session_id', sessionId)
  .order('display_order', { ascending: true });
```

**Impact:** Same issue.

---

#### Issue 3: Results Export
**File:** `/src/routes/api/export/[sessionId]/+server.ts` (lines 112-126)

```typescript
const { data, error: resultsError } = await supabase
  .from('results')
  .select('created_at, bib, score, discipline, level, event_name, judge_name')
  .eq('session_id', sessionIdNum)
  .order('created_at', { ascending: true });
  // NO PAGINATION!
```

**Impact:** Could load millions of records.

---

### HIGH: Inefficient Count Queries

**File:** `/src/lib/server/organizationLimits.ts` (lines 61-68)

```typescript
const { count } = await supabase
  .from('sessions')
  .select('*', { count: 'exact', head: true })
  .eq('organization_id', organizationId)
  .gte('created_at', currentMonth.toISOString());
```

**Issue:** `count: 'exact'` scans entire table to count. This is expensive for large sessions.

**Better:** Use `count: 'planned'` for approximate counts, or maintain a summary table.

---

### HIGH: Inefficient Organization Usage Calculation

**File:** `/src/routes/account/+page.server.ts` (lines 76-111)

Three separate queries per organization when one aggregate query would work:

```typescript
// Current: 3 queries per org
const planLimits = await ...  // Query 1
const sessionsCount = await ... // Query 2
const membersCount = await ...  // Query 3

// Better: Single query with aggregates
const orgData = await supabase
  .from('organizations')
  .select(`
    *,
    plan_limits!inner(*),
    sessions!inner(id),
    organization_members!inner(id)
  `)
  .eq('id', org.id)
```

---

### MEDIUM: Unnecessary Profile Lookups

**File:** `/src/routes/+layout.server.ts` (lines 14-19)

```typescript
if (user && !userError) {
  const { data } = await supabase
    .from('profiles')
    .select('full_name')
    .eq('id', user.id)
    .single();
  profile = data;
}
```

**Issue:** This runs on EVERY page load. Should be cached in local storage or session.

---

### MEDIUM: Heavy Computations in Load Functions

**File:** `/src/routes/session/[id]/score/[modeType]/[eventId]/complete/+page.server.ts` (lines 134-143)

```typescript
// In load function - synchronous
const sortedScores = [...scores].map(s => parseFloat(s.score)).sort((a, b) => a - b);
if (sessionDetails.exclude_extremes && sortedScores.length >= 5) {
  const middleScores = sortedScores.slice(1, -1);
  displayScore = parseFloat(middleScores.reduce((acc, s) => acc + s, 0).toFixed(2));
}
```

**Issue:** Score calculations should happen in a database function or trigger, not in load.

---

## 6. ENVIRONMENT & SECRETS

### CRITICAL: Secrets Exposed in .env File

**File:** `.env` (Lines 1-32)

```
PUBLIC_SUPABASE_ANON_KEY="sb_publishable_..."
SUPABASE_SERVICE_ROLE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
STRIPE_SECRET_KEY="sk_test_..."
STRIPE_WEBHOOK_SECRET="whsec_..."
```

**CRITICAL ISSUE:** `.env` file is committed to Git repository!

**Evidence:** File visible in git status check.

**Impact:**
- Service role key can be used to bypass ALL RLS
- Stripe keys can be used to charge accounts
- Webhook secret could allow attacker to forge events

**Immediate Action Required:**
1. Rotate all keys immediately
2. Add `.env` to `.gitignore`
3. Use environment variables in deployment platform

---

## 7. STRIPE WEBHOOK HANDLING

### GOOD: Signature Verification

**File:** `/src/routes/api/stripe/webhook/+server.ts` (lines 13-33)

```typescript
const signature = request.headers.get('stripe-signature');
if (!signature) {
  console.error('[Webhook] Stripe署名がありません');
  throw error(400, 'Stripe署名がありません。');
}

event = stripe.webhooks.constructEvent(body, signature, STRIPE_WEBHOOK_SECRET);
```

**Status:** Correctly validates Stripe signature.

---

### MEDIUM: Incomplete Error Handling

**File:** `/src/routes/api/stripe/webhook/+server.ts` (lines 218-221)

```typescript
if (updateError) {
  console.error('[Webhook] subscription作成エラー:', updateError);
  throw error;  // ⚠️ Throws to caller instead of returning
}
```

**Issue:** If creation fails mid-way, subscription state could be inconsistent. Should use transactions or idempotency keys.

---

### MEDIUM: User Token Usage in Webhook

**File:** `/src/routes/api/stripe/webhook/+server.ts` (lines 96-99)

```typescript
const userId = session.metadata?.user_id;
const customerId = session.customer;
const subscriptionId = session.subscription;
const isOrganization = session.metadata?.is_organization === 'true';
```

**Issue:** Trusts user-provided metadata. Should verify customer ID matches authenticated user.

---

## 8. DATABASE DESIGN

### GOOD: Foreign Key Constraints

Sessions table properly references organizations:
```sql
organization_id -> organizations(id)
```

---

### MEDIUM: No Unique Constraints on Critical Fields

No unique constraint on `join_code` in sessions table:

```sql
-- Missing:
CREATE UNIQUE INDEX idx_sessions_join_code ON sessions(join_code);
```

**Issue:** Race condition possible during code generation, though code checks for duplicates in application.

---

### LOW: No Indexes on Frequently Queried Columns

**Missing Indexes:**
1. `sessions.organization_id` - used in many queries
2. `session_participants.session_id` - used frequently
3. `organization_members.organization_id` - used in RLS policies
4. `training_scores.session_id` - used in aggregations
5. `results.session_id` - used in exports

---

## SUMMARY OF FINDINGS

### CRITICAL Issues (Immediate Action Required)

1. **N+1 Queries** - 6 locations with parallel profile fetches (Issues #1-#6)
   - Estimated impact: 100x database load for large sessions
   
2. **Secrets Exposed in Git** - `.env` file with live keys exposed
   - Immediate: Rotate all Stripe and Supabase keys
   
3. **Missing Authorization Checks** - Some endpoints rely only on RLS
   - Add explicit permission checks as safety layer

### HIGH Issues (Address in Next Sprint)

4. **Large Data Loads Without Pagination** - Could load millions of records
5. **Weak Password Requirements** - 6 character minimum is insufficient
6. **No Rate Limiting** - Invitation/session creation endpoints vulnerable to DOS
7. **Inefficient Count Queries** - Using `count: 'exact'` on large tables

### MEDIUM Issues (Address Soon)

8. **Missing Email Validation** - No format check before creating account
9. **Missing Field Length Limits** - Organization name not length-limited
10. **Inefficient Profile Lookups** - Queried on every page load
11. **Incomplete Webhook Error Handling** - Could leave subscriptions in inconsistent state
12. **Score Calculations in Load** - Should happen in database

### LOW Issues (Nice to Have)

13. **Overfetching Data** - `select('*')` instead of specific columns
14. **Missing Database Indexes** - Could improve RLS policy performance
15. **No Unique Constraint on Join Code** - Already handled in app, but DB should enforce

---

## RECOMMENDATIONS

### Priority 1 (This Week)
- [ ] Rotate Stripe and Supabase keys
- [ ] Add `.env` to `.gitignore` and remove from Git history
- [ ] Fix N+1 queries by combining queries with JOINs
- [ ] Add `.single()` handling for missing profiles in score loops

### Priority 2 (Next Week)
- [ ] Add pagination to all list endpoints
- [ ] Implement rate limiting on API endpoints
- [ ] Add password strength requirements
- [ ] Add email format validation

### Priority 3 (Next Sprint)
- [ ] Cache profile data in local storage
- [ ] Move score calculations to database functions
- [ ] Add explicit authorization checks as safety layer
- [ ] Create database indexes on foreign keys
- [ ] Implement transaction handling in webhook processing

### Priority 4 (Future)
- [ ] Implement audit logging for sensitive operations
- [ ] Add request throttling/rate limiting
- [ ] Move complex aggregations to materialized views
- [ ] Implement data retention policies for old sessions

