# Competition Mode (大会モード) Architecture Analysis

## Executive Summary

The judge-app implements a **Tournament/Competition Mode (大会モード)** alongside a standard **Certification Mode (検定モード)**. The competition mode includes:

- Custom event/category configuration
- Multiple judge management with a chief judge
- Two scoring methods: 3審3採 (3 judges) and 5審3採 (5 judges with extremes excluded)
- Tournament scoreboard with real-time updates
- Participant management

This document provides a comprehensive analysis for implementing a new **Training Mode (研修モード)** with different requirements.

---

## 1. Overall Architecture

### Session Types

```
Session (検定/大会)
├── is_tournament_mode: boolean
│   ├── false → Certification Mode (検定モード)
│   └── true  → Competition Mode (大会モード)
├── score_calculation: 'average' | 'sum'
├── exclude_extremes: boolean (for 5審3採)
└── chief_judge_id: UUID (主任検定員)
```

### Database Schema Structure

#### Sessions Table (Core)

- `id`: Primary key
- `name`: Session name
- `created_by`: Creator user ID
- `chief_judge_id`: Chief judge user ID (can be changed)
- `is_tournament_mode`: Boolean flag for tournament mode
- `score_calculation`: 'average' (for kentei mode) | 'sum' (for tournament mode)
- `exclude_extremes`: Boolean (true = 5審3採, false = 3審3採)
- `is_active`: Boolean
- `active_prompt_id`: Current scoring instruction ID
- `is_multi_judge`: For certification mode judge management
- `required_judges`: Number of judges needed

**File**: `/Users/uchidatomohisa/Code/judge-app/database/migrations/001_add_tournament_mode.sql`

#### Custom Events Table (Tournament Mode Specific)

```sql
CREATE TABLE custom_events (
  id bigserial PRIMARY KEY,
  session_id bigint REFERENCES sessions(id),
  discipline text NOT NULL,
  level text NOT NULL,
  event_name text NOT NULL,
  display_order int DEFAULT 0,
  created_at timestamp,
  updated_at timestamp
);
```

#### Participants Table (Tournament Mode Specific)

```sql
CREATE TABLE participants (
  id bigserial PRIMARY KEY,
  session_id bigint REFERENCES sessions(id),
  bib_number int NOT NULL,
  athlete_name text NOT NULL,
  team_name text,
  CONSTRAINT unique_bib_per_session UNIQUE(session_id, bib_number)
);
```

#### Results Table (Shared)

- Stores individual judge scores
- Keys: `session_id`, `bib`, `discipline`, `level`, `event_name`, `judge_name`, `score`

#### Session Participants Table (Shared)

- Links users to sessions
- Manages judge membership

---

## 2. Competition Mode Implementation Details

### 2.1 How Competition Mode is Structured

**Location**: `/Users/uchidatomohisa/Code/judge-app/src/routes/session/[id]/tournament-*`

#### Creation Flow

**File**: `/Users/uchidatomohisa/Code/judge-app/src/routes/session/create/+page.server.ts` (lines 80-127)

```typescript
const isTournamentMode = mode === 'tournament';

const sessionData = await supabase.from('sessions').insert({
	name: sessionName,
	created_by: user.id,
	chief_judge_id: user.id, // Creator becomes chief judge
	join_code: joinCode,
	is_active: true,
	is_tournament_mode: isTournamentMode, // Key flag
	score_calculation: isTournamentMode ? 'sum' : 'average',
	exclude_extremes: false
});

// Redirect to tournament-setup for configuration
if (isTournamentMode) {
	throw redirect(303, `/session/${sessionData.id}/tournament-setup`);
}
```

#### Setup Flow

**File**: `/Users/uchidatomohisa/Code/judge-app/src/routes/session/[id]/tournament-setup/+page.svelte`

Configuration requires:

1. **Events Setup** - Add custom categories/events
2. **Scoring Method** - Choose 3審3採 or 5審3採
3. **Participants** (Optional) - Register athlete/team information

### 2.2 How Judges (検定員) are Managed

#### Chief Judge Concept

- **Single Chief Judge** (主任検定員): Controls the session
- **Role**: Finalizes scores, confirms entries, ends session
- **Authorization**: Checked via `chief_judge_id` field
- **Can be changed**: Via `/session/[id]/details/+page.server.ts` `appointChief` action

**File**: `/Users/uchidatomohisa/Code/judge-app/src/routes/session/[id]/details/+page.server.ts` (lines 98-135)

```typescript
export const actions: Actions = {
	appointChief: async ({ request, params, locals: { supabase } }) => {
		const formData = await request.formData();
		const userIdToAppoint = formData.get('userId') as string;

		// Toggle chief judge appointment
		const newChiefId = currentSession?.chief_judge_id === userIdToAppoint ? null : userIdToAppoint;

		await supabase.from('sessions').update({ chief_judge_id: newChiefId }).eq('id', params.id);
	}
};
```

#### Judge Judge List Display

**File**: `/Users/uchidatomohisa/Code/judge-app/src/routes/session/[id]/details/+page.svelte` (lines 94-126)

Shows:

- All session participants
- Current chief judge badge
- Option to appoint/remove chief judge (only for session creator)

#### Judge Permissions

- **Chief Judge**: Can enter bib numbers, see all scores, finalize scores, end session
- **Regular Judges**: Can only score when prompted, see waiting screen
- **Waitlist UI**: Regular judges wait for the next bib number to score

**File**: `/Users/uchidatomohisa/Code/judge-app/src/routes/session/[id]/tournament-events/[eventId]/score/status/+page.svelte`

---

## 3. Scoring Implementation (得点)

### 3.1 Two Scoring Methods

#### 3審3採 (3-Judges Method)

- **Requires**: Exactly 3 judges
- **Calculation**: Sum of 3 scores
- **Example**: 8.5 + 8.0 + 8.5 = 25.0

#### 5審3採 (5-Judges with Extremes Excluded)

- **Requires**: Exactly 5 judges
- **Calculation**: Remove max and min scores, sum the middle 3
- **Example**: 8.5 + 8.0 + 9.0 + 8.5 + 7.5 → Remove 7.5 and 9.0 → 8.5 + 8.0 + 8.5 = 25.0

### 3.2 Scoring Logic in Tournament Mode

**Primary File**: `/Users/uchidatomohisa/Code/judge-app/src/routes/session/[id]/tournament-events/[eventId]/score/status/+page.server.ts` (lines 52-147)

```typescript
export const actions: Actions = {
	finalizeScore: async ({ request, params, locals: { supabase }, url }) => {
		// Get all scores
		const scores = await supabase
			.from('results')
			.select('score')
			.eq('session_id', sessionId)
			.eq('bib', bib)
			.eq('discipline', customEvent.discipline)
			.eq('level', customEvent.level)
			.eq('event_name', customEvent.event_name);

		let finalScore = 0;

		if (sessionData.exclude_extremes) {
			// 5審3採: 最大・最小を除く3人の合計
			if (scores.length < 5) {
				return fail(400, { error: `5審3採では5人の採点が必要です。現在${scores.length}人です。` });
			}

			const scoreValues = scores.map((s) => s.score).sort((a, b) => a - b);
			const middleThree = scoreValues.slice(1, 4); // Skip first and last after sorting
			finalScore = middleThree.reduce((sum, s) => sum + s, 0);
		} else {
			// 3審3採: 3人の合計
			if (scores.length < 3) {
				return fail(400, { error: `3審3採では3人の採点が必要です。現在${scores.length}人です。` });
			}

			const scoreValues = scores.map((s) => s.score);
			finalScore = scoreValues.reduce((sum, s) => sum + s, 0);
		}

		// Redirect to completion screen
		throw redirect(
			303,
			`/session/${sessionId}/tournament-events/${eventId}/score/complete?bib=${bib}&score=${finalScore}`
		);
	}
};
```

### 3.3 Scoring Configuration Page

**File**: `/Users/uchidatomohisa/Code/judge-app/src/routes/session/[id]/tournament-setup/scoring/+page.svelte`

- Radio button selection between 3審3採 and 5審3採
- Configuration saved to `exclude_extremes` field
- Can be changed during tournament

### 3.4 Real-time Score Status

**File**: `/Users/uchidatomohisa/Code/judge-app/src/routes/session/[id]/tournament-events/[eventId]/score/status/+page.svelte` (lines 26-46)

Uses API endpoint: `/api/score-status/[sessionId]/[bib]`

**File**: `/Users/uchidatomohisa/Code/judge-app/src/routes/api/score-status/[sessionId]/[bib]/+server.ts` (lines 48-52)

```typescript
// 大会モードの場合は exclude_extremes に基づいて必要な検定員数を決定
let requiredJudges = sessionData.required_judges;
if (sessionData.is_tournament_mode) {
	requiredJudges = sessionData.exclude_extremes ? 5 : 3;
}
```

---

## 4. Events/Categories (種目) Configuration

### 4.1 Event Structure in Tournament Mode

**File**: `/Users/uchidatomohisa/Code/judge-app/src/routes/session/[id]/tournament-setup/events/+page.server.ts`

Custom events stored with:

- `event_name`: Name of the event/category
- `discipline`: Fixed to '大会' (tournament)
- `level`: Fixed to '共通' (common)
- `display_order`: Order in which events appear

This design allows flexible event naming while keeping discipline/level consistent.

### 4.2 Event Management UI

**File**: `/Users/uchidatomohisa/Code/judge-app/src/routes/session/[id]/tournament-setup/events/+page.svelte`

Functions:

- Add new events with custom names
- Display count of registered events
- Remove/reorder events (via display_order)

### 4.3 Event Selection Flow

**File**: `/Users/uchidatomohisa/Code/judge-app/src/routes/session/[id]/tournament-events/+page.server.ts` (lines 37-57)

```typescript
// Chief judge only - fetch custom events
const customEvents = await supabase
	.from('custom_events')
	.select('*')
	.eq('session_id', sessionId)
	.order('display_order', { ascending: true });
```

---

## 5. Overall Architecture & File Structure

### 5.1 Routing Structure

```
/session/[id]/
├── tournament-setup/              (Configuration phase)
│   ├── +page.svelte              (Setup overview)
│   ├── events/                   (Event management)
│   ├── scoring/                  (Scoring method selection)
│   └── participants/             (Athlete registration)
├── tournament-events/            (Scoring phase - Chief judge)
│   ├── +page.svelte              (Event selection)
│   └── [eventId]/score/
│       ├── +page.svelte          (Bib number input)
│       ├── status/               (Score confirmation screen)
│       │   └── +page.svelte      (Real-time score display)
│       └── complete/             (Score finalization)
├── [discipline]/[level]/[event]/ (Scoring flow for judges)
│   └── score/
│       ├── status/               (Score confirmation - Regular judges)
│       └── complete/
└── scoreboard/                   (Public scoreboard)
    └── +page.svelte              (Rankings display)

/scoreboard/[sessionId]/          (Public - no auth required)
```

### 5.2 Key Component Files

| File Path                                                                          | Purpose                                   | Mode       |
| ---------------------------------------------------------------------------------- | ----------------------------------------- | ---------- |
| `src/routes/session/create/+page.server.ts`                                        | Session creation with mode selection      | Both       |
| `src/routes/session/[id]/+page.server.ts`                                          | Main session hub, redirects based on role | Both       |
| `src/routes/session/[id]/tournament-setup/+page.server.ts`                         | Setup page loader                         | Tournament |
| `src/routes/session/[id]/tournament-setup/scoring/+page.server.ts`                 | Scoring method configuration              | Tournament |
| `src/routes/session/[id]/tournament-events/+page.server.ts`                        | Event selection (chief judge only)        | Tournament |
| `src/routes/session/[id]/tournament-events/[eventId]/score/status/+page.server.ts` | Core scoring logic                        | Tournament |
| `src/routes/session/[id]/scoreboard/+page.server.ts`                               | Rankings aggregation                      | Tournament |
| `src/routes/api/score-status/[sessionId]/[bib]/+server.ts`                         | Real-time score polling                   | Tournament |

### 5.3 Data Flow Diagram

```
1. Create Session
   ↓
2. Select Mode (Certification vs Tournament)
   ↓
3. If Tournament: Setup Phase
   ├── Add Events
   ├── Choose Scoring Method (3-3 or 5-3)
   └── Register Participants (optional)
   ↓
4. Scoring Phase
   ├── Chief Judge: Select Event → Input Bib → Review Scores → Finalize
   ├── Regular Judges: Wait → Get Prompted with Bib → Enter Score
   └── Chief: Approve or Request Correction
   ↓
5. View Results
   ├── Scoreboard: Real-time rankings
   ├── Export: Excel file with detailed results
   └── Share: Public URL (no auth required)
```

---

## 6. Key Design Patterns

### 6.1 Chief Judge Authorization Pattern

```typescript
// Check if user is chief judge
const isChief = user.id === sessionDetails.chief_judge_id;

// Enforce chief-only operations
if (user.id !== sessionDetails.chief_judge_id) {
	throw redirect(303, `/session/${sessionId}`);
}
```

### 6.2 Scoring Prompt Pattern

```typescript
// Create a scoring instruction
const prompt = await supabase.from('scoring_prompts').insert({
	session_id: sessionId,
	discipline: customEvent.discipline,
	level: customEvent.level,
	event_name: customEvent.event_name,
	bib_number: bibNumber
});

// Update session with active prompt
await supabase.from('sessions').update({ active_prompt_id: prompt.id });

// Clear prompt after finalization
await supabase.from('sessions').update({ active_prompt_id: null });
```

### 6.3 Real-time Status Pattern

```typescript
// Polling every 3 seconds (client-side)
pollingInterval = setInterval(() => {
  fetch(`/api/score-status/${sessionId}/${bib}`);
}, 3000);

// Realtime subscription for judge status changes
const realtimeChannel = supabase.channel(`session-finalize-${sessionId}`)
  .on('postgres_changes', { ... })
  .subscribe();
```

---

## 7. Current Judge Limits

### Judge Capacity

**Current Limitations**:

- **Certification Mode**: `required_judges` field (configurable, typically 3-5)
- **Tournament Mode**: Fixed to 3 or 5 judges based on `exclude_extremes` flag
- **No built-in limit** on total number of judges per session
- **Practical limit**: Limited only by database capacity

**File References**:

- Session table doesn't have a `max_judges` field
- Scoring logic accepts any number of scores
- UI shows count but doesn't enforce maximum

---

## 8. Roadmap for Training Mode (研修モード)

### Proposed Architecture

```
Session
├── is_tournament_mode: false
├── is_training_mode: true (NEW)
├── mode: 'certification' | 'tournament' | 'training' (NEW)
├── chief_judge_id: UUID (required)
├── max_judges: integer (NEW - support up to 100)
└── score_display_mode: 'aggregate' | 'individual' (NEW)
    ├── 'aggregate' = 5審3採/3審3採 (current)
    └── 'individual' = show each judge's score (NEW)
```

### Key Differences from Competition Mode

| Feature             | Competition         | Training                         |
| ------------------- | ------------------- | -------------------------------- |
| Max Judges          | 3 or 5              | Up to 100                        |
| Chief Judge         | 1 (主任検定員)      | 1 (required)                     |
| Scoring Aggregation | 5審3採 / 3審3採     | None (display individual scores) |
| Event Config        | Custom              | Custom (same)                    |
| Scoreboard          | Ranked by total     | Individual scores for each judge |
| Purpose             | Competition scoring | Training/evaluation              |

### Implementation Changes Needed

1. **Database Schema**
   - Add `is_training_mode` column to sessions
   - Add `max_judges` field
   - Add `score_display_mode` field

2. **Scoring Logic**
   - Skip aggregation for training mode
   - Store individual judge scores
   - Display without ranking/aggregation

3. **UI Changes**
   - New mode selection in session creation
   - Training-specific setup page
   - Individual score display (not aggregate)

4. **Scoreboard**
   - Show raw judge scores
   - No ranking calculation
   - Individual evaluation view

---

## 9. Key Files Reference Summary

### Core Database/Schema

- `/Users/uchidatomohisa/Code/judge-app/database/migrations/001_add_tournament_mode.sql`

### Session Management

- `/Users/uchidatomohisa/Code/judge-app/src/routes/session/create/+page.server.ts`
- `/Users/uchidatomohisa/Code/judge-app/src/routes/session/[id]/+page.server.ts`
- `/Users/uchidatomohisa/Code/judge-app/src/routes/session/[id]/details/+page.server.ts`

### Tournament Setup

- `/Users/uchidatomohisa/Code/judge-app/src/routes/session/[id]/tournament-setup/+page.server.ts`
- `/Users/uchidatomohisa/Code/judge-app/src/routes/session/[id]/tournament-setup/scoring/+page.server.ts`
- `/Users/uchidatomohisa/Code/judge-app/src/routes/session/[id]/tournament-setup/events/+page.server.ts`
- `/Users/uchidatomohisa/Code/judge-app/src/routes/session/[id]/tournament-setup/participants/+page.server.ts`

### Tournament Scoring

- `/Users/uchidatomohisa/Code/judge-app/src/routes/session/[id]/tournament-events/[eventId]/score/status/+page.server.ts` **[CORE SCORING LOGIC]**
- `/Users/uchidatomohisa/Code/judge-app/src/routes/api/score-status/[sessionId]/[bib]/+server.ts` **[REAL-TIME API]**

### Results Display

- `/Users/uchidatomohisa/Code/judge-app/src/routes/session/[id]/scoreboard/+page.server.ts`
- `/Users/uchidatomohisa/Code/judge-app/src/routes/scoreboard/[sessionId]/+page.server.ts` (public)

---

## Conclusion

The codebase demonstrates a well-structured tournament mode implementation with:

1. **Clear separation** between certification and tournament modes
2. **Flexible chief judge** management (single point of control)
3. **Two scoring aggregation methods** (3-3 and 5-3)
4. **Custom event configuration** with proper ordering
5. **Real-time status updates** using Supabase polling
6. **Public scoreboard** for audience viewing
7. **Participant management** for tournament records

The training mode can leverage this infrastructure with minimal modifications, primarily focusing on:

- Adding a new session type flag
- Modifying scoring logic to skip aggregation
- Updating UI to display individual judge scores instead of totals
