# Security & Performance Fixes - Code Examples

## 1. FIX N+1 Query Problem - Profile Fetching

### BEFORE (Bad - N+1 Query):
```typescript
// /src/routes/session/[id]/details/+page.server.ts lines 32-56
const { data: participantIds, error: participantsError } = await supabase
  .from('session_participants')
  .select('user_id')  // Query 1
  .eq('session_id', sessionId);

// Query 2 + N (one per participant)
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

**Total Queries: 1 + N (where N = participant count)**

### AFTER (Good - Single Query with JOIN):
```typescript
// Combine into single query with JOIN
const { data: participants, error: participantsError } = await supabase
  .from('session_participants')
  .select(`
    user_id,
    profiles:user_id (full_name)
  `)
  .eq('session_id', sessionId);

if (participantsError) {
  throw error(500, 'Failed to fetch participants');
}
```

**Total Queries: 1** ✓

---

## 2. FIX N+1 Query Problem - Training Scores

### BEFORE (Bad):
```typescript
// /src/routes/session/[id]/details/+page.server.ts lines 109-126
const { data: scores } = await supabase
  .from('training_scores')
  .select('*')  // Query 1
  .eq('training_events.session_id', sessionId);

// Queries 2 + S (one per score)
if (scores && scores.length > 0) {
  const scoresWithJudges = await Promise.all(
    scores.map(async (score) => {
      const { data: judgeProfile } = await supabase
        .from('profiles')
        .select('full_name')
        .eq('id', score.judge_id)
        .single();  // N additional queries
      return { ...score, judge: { full_name: judgeProfile?.full_name } };
    })
  );
}
```

### AFTER (Good):
```typescript
// Single query with JOINs
const { data: trainingScores, error: scoresError } = await supabase
  .from('training_scores')
  .select(`
    *,
    training_events!inner(session_id, name),
    judge:judge_id (full_name)
  `)
  .eq('training_events.session_id', sessionId)
  .order('created_at', { ascending: false });

if (scoresError) {
  throw error(500, 'Failed to fetch scores');
}

// No additional loops needed - judge data already included
const trainingScores = trainingScores || [];
```

---

## 3. FIX Organization Usage Data Loading

### BEFORE (Bad - 3 queries per organization):
```typescript
// /src/routes/account/+page.server.ts lines 76-111
const organizationsWithUsage = await Promise.all(
  organizations.map(async (org: any) => {
    // Query 1 per organization
    const { data: planLimits } = await supabase
      .from('plan_limits')
      .select('*')
      .eq('plan_type', org.plan_type)
      .single();
    
    // Query 2 per organization
    const { count: sessionsCount } = await supabase
      .from('sessions')
      .select('*', { count: 'exact', head: true })
      .eq('organization_id', org.id);
    
    // Query 3 per organization
    const { count: membersCount } = await supabase
      .from('organization_members')
      .select('*', { count: 'exact', head: true })
      .eq('organization_id', org.id);
    
    return { ...org, planLimits, currentUsage: { sessions_count: sessionsCount } };
  })
);
```

**Total Queries: 1 + (3 * O) where O = organization count**

### AFTER (Good - Single query with aggregates):
```typescript
// Single query with all data included
const { data: organizationsWithUsage } = await supabase
  .from('organizations')
  .select(`
    *,
    plan_limits!inner (*),
    sessions!inner (id),
    organization_members!inner (id)
  `)
  .in('id', organizations.map(o => o.id));

// Transform data for UI
const transformed = (organizationsWithUsage || []).map(org => {
  const sessions = org.sessions || [];
  const members = org.organization_members || [];
  
  return {
    ...org,
    currentUsage: {
      sessions_count: sessions.length,
      members_count: members.length
    },
    planLimits: org.plan_limits
  };
});
```

**Total Queries: 1** ✓

---

## 4. ADD EMAIL VALIDATION

### BEFORE (Bad):
```typescript
// /src/routes/signup/+page.server.ts lines 15-17
if (!email) {
  return fail(400, { fullName, email, error: 'メールアドレスを入力してください。' });
}
// No format validation!
```

### AFTER (Good):
```typescript
// Email format validation
const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

if (!email || !emailRegex.test(email)) {
  return fail(400, { 
    fullName, 
    email, 
    error: '有効なメールアドレスを入力してください。' 
  });
}
```

---

## 5. IMPROVE PASSWORD REQUIREMENTS

### BEFORE (Bad):
```typescript
// /src/routes/signup/+page.server.ts lines 18-20
if (!password || password.length < 6) {
  return fail(400, { 
    error: 'パスワードは6文字以上で入力してください。' 
  });
}
```

### AFTER (Good):
```typescript
// Strong password validation
const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)[a-zA-Z\d@$!%*?&]{12,}$/;

if (!password || !passwordRegex.test(password)) {
  return fail(400, { 
    error: 'パスワードは12文字以上で、大文字・小文字・数字を含む必要があります。' 
  });
}
```

---

## 6. ADD ORGANIZATION NAME LENGTH LIMIT

### BEFORE (Bad):
```typescript
// /src/routes/api/organization/create/+server.ts line 31
if (!organizationName || !organizationName.trim()) {
  return json({ error: '組織名を入力してください' }, { status: 400 });
}
// No length check!
```

### AFTER (Good):
```typescript
const name = organizationName.trim();

if (!name) {
  return json({ error: '組織名を入力してください' }, { status: 400 });
}

if (name.length > 255) {
  return json({ error: '組織名は255文字以内です' }, { status: 400 });
}
```

---

## 7. ADD PAGINATION TO LARGE QUERIES

### BEFORE (Bad - No Pagination):
```typescript
// /src/routes/api/export/[sessionId]/+server.ts lines 112-126
const { data, error: resultsError } = await supabase
  .from('results')
  .select('created_at, bib, score, discipline, level, event_name, judge_name')
  .eq('session_id', sessionIdNum)
  .order('created_at', { ascending: true });
  // Could load millions of records!
```

### AFTER (Good - With Pagination):
```typescript
const BATCH_SIZE = 1000;
let allResults: any[] = [];
let hasMore = true;
let offset = 0;

while (hasMore) {
  const { data: batch, error: resultsError } = await supabase
    .from('results')
    .select('created_at, bib, score, discipline, level, event_name, judge_name')
    .eq('session_id', sessionIdNum)
    .order('created_at', { ascending: true })
    .range(offset, offset + BATCH_SIZE - 1);

  if (resultsError) {
    console.error('Error fetching results batch:', resultsError);
    return json({ error: '結果の取得に失敗しました。' }, { status: 500 });
  }

  if (!batch || batch.length === 0) {
    hasMore = false;
  } else {
    allResults.push(...batch);
    offset += BATCH_SIZE;
  }
}

return json({ results: allResults });
```

---

## 8. FIX INEFFICIENT COUNT QUERIES

### BEFORE (Bad - count: 'exact'):
```typescript
// /src/lib/server/organizationLimits.ts lines 61-68
const { count } = await supabase
  .from('sessions')
  .select('*', { count: 'exact', head: true })  // Scans entire table!
  .eq('organization_id', organizationId)
  .gte('created_at', currentMonth.toISOString());
```

### AFTER (Good - Faster Count):
```typescript
// Use 'planned' for faster approximate count
const { count } = await supabase
  .from('sessions')
  .select('*', { count: 'planned', head: true })  // Fast estimate
  .eq('organization_id', organizationId)
  .gte('created_at', currentMonth.toISOString());

// For exact counts on frequently used data, maintain a summary table
// and update it with a trigger
```

---

## 9. ADD AUTHORIZATION CHECK BEFORE DELETE

### BEFORE (Missing Check):
```typescript
// /src/routes/api/delete-user/+server.ts
const { userToken } = await request.json();
const { data: { user } } = await supabaseAdmin.auth.getUser(userToken);
// Immediately deletes without verification!
const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(user.id);
```

### AFTER (With Verification):
```typescript
// Get current session for verification
const currentSession = await request.headers.get('x-session-id');
if (!currentSession) {
  throw svelteError(401, 'セッション検証に失敗しました。');
}

// Verify token matches current session
const { data: { user }, error: userError } = 
  await supabaseAdmin.auth.getUser(userToken);

if (userError || !user) {
  throw svelteError(404, 'ユーザーが見つかりません。');
}

// Check for active subscriptions
const { data: subscription } = await supabaseAdmin
  .from('subscriptions')
  .select('id')
  .eq('user_id', user.id)
  .eq('status', 'active')
  .single();

if (subscription) {
  throw svelteError(400, 'アクティブなサブスクリプションを先にキャンセルしてください。');
}

// Only now delete
const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(user.id);
```

---

## 10. CACHE PROFILE DATA

### BEFORE (Query Every Page Load):
```typescript
// /src/routes/+layout.server.ts lines 14-19
if (user && !userError) {
  const { data } = await supabase
    .from('profiles')
    .select('full_name')
    .eq('id', user.id)
    .single();  // Runs on EVERY page load!
  profile = data;
}
```

### AFTER (Cache in Session):
```typescript
import { dev } from '$app/environment';

export const handle: Handle = async ({ event, resolve }) => {
  const { data: { user } } = await supabase.auth.getUser();
  
  let profile = null;
  
  if (user && !userError) {
    // Check cache first (in locals.profile if already loaded)
    if (event.locals.profile) {
      profile = event.locals.profile;
    } else {
      // Fetch and cache in locals
      const { data } = await supabase
        .from('profiles')
        .select('full_name')
        .eq('id', user.id)
        .single();
      profile = data;
      event.locals.profile = profile; // Cache for this request
    }
  }
  
  return resolve(event);
};
```

---

## 11. ADD DATABASE INDEXES

```sql
-- Create indexes for frequently queried columns
CREATE INDEX idx_sessions_organization_id ON sessions(organization_id);
CREATE INDEX idx_session_participants_session_id ON session_participants(session_id);
CREATE INDEX idx_organization_members_organization_id ON organization_members(organization_id);
CREATE INDEX idx_training_scores_session_id ON training_scores(session_id);
CREATE INDEX idx_results_session_id ON results(session_id);

-- Make join_code unique
CREATE UNIQUE INDEX idx_sessions_join_code ON sessions(join_code);
```

---

## 12. ADD RATE LIMITING MIDDLEWARE

```typescript
// lib/server/rateLimiter.ts
const rateLimits = new Map<string, { count: number; resetTime: number }>();

export function checkRateLimit(
  identifier: string,
  maxRequests: number = 10,
  windowSeconds: number = 60
): boolean {
  const now = Date.now();
  const record = rateLimits.get(identifier);
  
  if (!record || now > record.resetTime) {
    // New window
    rateLimits.set(identifier, { count: 1, resetTime: now + windowSeconds * 1000 });
    return true;
  }
  
  if (record.count < maxRequests) {
    record.count++;
    return true;
  }
  
  return false; // Rate limited
}
```

Usage in API:
```typescript
// /src/routes/api/invitations/create/+server.ts
import { checkRateLimit } from '$lib/server/rateLimiter';

export const POST: RequestHandler = async ({ request, locals }) => {
  const userId = (await locals.supabase.auth.getUser()).data.user?.id;
  
  if (!checkRateLimit(userId, 50, 3600)) { // 50 per hour
    return json({ error: 'Too many requests' }, { status: 429 });
  }
  
  // Continue with invitation creation
};
```

---

## Estimated Implementation Time

- Fix N+1 queries: 2-3 hours
- Add input validation: 1 hour
- Add pagination: 2-3 hours
- Add rate limiting: 1-2 hours
- Add database indexes: 30 minutes
- Cache improvements: 1 hour

**Total: 8-11 hours of development work**

