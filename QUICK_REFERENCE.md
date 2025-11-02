# Quick Reference: Judge App Architecture

## File Structure Summary

### Database & Schema
```
database/migrations/
└── 001_add_tournament_mode.sql      [Core schema for tournament mode]
```

### Session Management
```
src/routes/session/
├── create/+page.server.ts            [Mode selection: cert/tournament]
├── [id]/+page.server.ts              [Main hub, route dispatcher]
├── [id]/details/+page.server.ts      [Judge management, chief judge appointment]
└── join/+page.server.ts              [Join session with code]
```

### Tournament Setup
```
src/routes/session/[id]/tournament-setup/
├── +page.server.ts                   [Setup overview]
├── events/+page.server.ts            [Custom event CRUD]
├── scoring/+page.server.ts           [3審3採 / 5審3採 selection]
└── participants/+page.server.ts      [Athlete/team registration]
```

### Tournament Scoring (Main Logic)
```
src/routes/session/[id]/tournament-events/
├── +page.server.ts                   [Fetch custom events, chief-only]
├── [eventId]/score/+page.server.ts   [Bib input page]
├── [eventId]/score/status/+page.server.ts    [CORE SCORING LOGIC]
└── [eventId]/score/complete/+page.server.ts  [Finalization]
```

### Certification Scoring (Still Used for Cert Mode)
```
src/routes/session/[id]/[discipline]/[level]/[event]/
└── score/status/+page.server.ts      [Shared scoring logic for both modes]
```

### Results Display
```
src/routes/session/[id]/
├── scoreboard/+page.server.ts        [Private: authenticated view]
└── [Public] /scoreboard/[sessionId]/+page.server.ts  [Public: no auth]
```

### APIs
```
src/routes/api/score-status/[sessionId]/[bib]/+server.ts  [Real-time polling]
```

---

## Core Data Flow

### Creating a Session
```
1. User selects "大会モード" (tournament mode)
2. is_tournament_mode = true
3. score_calculation = 'sum' (vs 'average' for cert)
4. exclude_extremes = false (default, can change to true)
5. chief_judge_id = user.id (creator becomes chief)
6. Redirect to /tournament-setup/
```

### Scoring in Tournament Mode
```
1. Chief judge: /tournament-events/ → Select event
2. Chief judge: /tournament-events/[eventId]/score/ → Input bib #
3. Creates scoring_prompt → active_prompt_id set
4. All judges get notified (via polling/realtime)
5. Judges score (3 or 5 of them)
6. Chief judge: /tournament-events/[eventId]/score/status/ → Review scores
7. Chief judge: Finalize scores
   - If exclude_extremes = false (3審3採): Sum all 3 scores
   - If exclude_extremes = true (5審3採): Remove max/min, sum middle 3
8. Results saved
9. active_prompt_id cleared → Next bib can be scored
```

### Displaying Results
```
/session/[id]/scoreboard/ → Aggregate by bib, rank by total score
/scoreboard/[sessionId]/ → Public view, same ranking
```

---

## Key Scoring Logic Locations

### Where 3審3採 / 5審3採 is Implemented

**File**: `src/routes/session/[id]/tournament-events/[eventId]/score/status/+page.server.ts`

Lines 112-156:
```typescript
if (sessionData.exclude_extremes) {
  // 5審3採
  const scoreValues = scores.map(s => s.score).sort((a, b) => a - b);
  const middleThree = scoreValues.slice(1, 4);
  finalScore = middleThree.reduce((sum, s) => sum + s, 0);
} else {
  // 3審3採
  const scoreValues = scores.map(s => s.score);
  finalScore = scoreValues.reduce((sum, s) => sum + s, 0);
}
```

---

## Database Tables

### sessions
- `id`: Primary key
- `name`: Session name
- `created_by`: Creator user ID
- `chief_judge_id`: Who controls the session
- `is_tournament_mode`: Boolean (main mode flag)
- `score_calculation`: 'average' | 'sum'
- `exclude_extremes`: Boolean (5審3採 if true)
- `active_prompt_id`: Current scoring instruction
- `is_active`: Whether session is running

### custom_events (Tournament mode only)
- `id`: Primary key
- `session_id`: FK to sessions
- `discipline`: Always '大会' in tournament mode
- `level`: Always '共通' in tournament mode
- `event_name`: Custom name (e.g., "フリースタイル")
- `display_order`: Ordering

### participants (Tournament mode only)
- `id`: Primary key
- `session_id`: FK to sessions
- `bib_number`: Athlete number
- `athlete_name`: Name
- `team_name`: Team

### results (Shared)
- `session_id`: FK
- `bib`: Athlete number
- `discipline`: From custom_event
- `level`: From custom_event
- `event_name`: From custom_event
- `judge_name`: Who scored
- `score`: The score

### session_participants (Shared)
- `session_id`: FK
- `user_id`: FK (judge)

---

## Authorization Patterns

### Chief Judge Only
```typescript
if (user.id !== sessionDetails.chief_judge_id) {
  throw redirect(303, '/');
}
```

Applies to:
- /tournament-events/ (view all events)
- /tournament-events/[eventId]/score/ (input bib)
- /tournament-events/[eventId]/score/status/ (review scores)
- /tournament-setup/* (configure tournament)

### Any Judge
```typescript
// Can score when session is active and they have a prompt
if (!sessionDetails.is_active) {
  // Wait for prompt
}
```

---

## Polling & Real-time

### Client-side Polling (Every 3 seconds)
File: `tournament-events/[eventId]/score/status/+page.svelte`

```typescript
pollingInterval = setInterval(() => {
  fetch(`/api/score-status/${sessionId}/${bib}`);
}, 3000);
```

### Realtime Subscription (for judges)
When score is finalized:
```typescript
realtimeChannel = supabase.channel(`session-finalize-${sessionId}`)
  .on('postgres_changes', { event: 'UPDATE', table: 'sessions' })
  .subscribe();
```

---

## Scoreboard Logic

### Aggregation in scoreboard/+page.server.ts
```typescript
// For each bib, sum all individual results
bibScores.set(bib, { total: sum, events: {...} });

// Rank by total
overallRanking.sort((a, b) => b.total_score - a.total_score);
```

**Key point**: The scoreboard SUMS all judge scores per event, it doesn't do 5審3採 exclusion. The exclusion happens BEFORE storing in database (during finalization).

---

## Training Mode (研修モード) Changes Needed

### What to Change
1. Add `is_training_mode` column to sessions table
2. Skip aggregation logic for training mode
3. Display individual judge scores in scoreboard (no ranking)
4. Support 100 judges instead of fixed 3 or 5

### What NOT to Change
- Chief judge concept (still need 1 chief)
- Custom event management (same)
- Participant registration (same)
- Database results table (store same data)
- Judge inviting/joining (same)

### Files to Modify
1. Database migration (add column)
2. Session creation form (add mode selection)
3. Score finalization logic (conditional: aggregate or not)
4. Scoreboard display logic (conditional: show aggregate or individual)

---

## Testing Key Flows

### Tournament with 3審3採
1. Create tournament
2. Add 3 judges
3. Add 1 event
4. Score 3 times with different scores (e.g., 8.0, 8.5, 8.0)
5. Finalize: Should get 24.5
6. Check scoreboard: 24.5 displayed

### Tournament with 5審3採
1. Create tournament, set to 5審3採
2. Add 5 judges
3. Score 5 times: 7.5, 8.0, 8.5, 9.0, 9.5
4. Finalize: Should calculate as 8.0+8.5+9.0 = 25.5 (middle 3)
5. Check scoreboard: 25.5 displayed

### Training Mode (Proposed)
1. Create training session
2. Add 50 judges
3. All 50 judges score
4. Finalize: No aggregation, show all 50 individual scores
5. Scoreboard shows table: Bib | Judge1 | Judge2 | ... | Judge50

---

## Quick Grep Commands

Find all references to exclude_extremes:
```bash
grep -r "exclude_extremes" src/
```

Find all score finalization logic:
```bash
grep -r "finalScore\|finalizeScore" src/
```

Find chief judge checks:
```bash
grep -r "chief_judge_id" src/
```

Find tournament mode checks:
```bash
grep -r "is_tournament_mode" src/
```

