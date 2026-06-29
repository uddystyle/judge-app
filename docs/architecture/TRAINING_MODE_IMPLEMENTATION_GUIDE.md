# Training Mode (研修モード) Implementation Guide

Based on the analysis of the current Competition Mode (大会モード) implementation, this guide provides a roadmap for implementing the Training Mode with support for up to 100 judges.

## Quick Reference: Current Competition Mode

### Scoring Methods
```
3審3採 (3 Judges)
├── Required judges: Exactly 3
└── Score = Judge1 + Judge2 + Judge3

5審3採 (5 Judges with Extremes)
├── Required judges: Exactly 5
└── Score = Middle3 (remove max and min)
```

### Judge Management
```
Single Chief Judge (主任検定員)
├── Selects events
├── Inputs bib numbers
├── Reviews all scores
├── Finalizes/approves scores
└── Can be changed dynamically

Other Judges
├── Wait for prompt
├── Score when given bib number
└── See only their own scoring screen
```

---

## Proposed Training Mode Architecture

### 1. Database Changes

Add to `sessions` table:

```sql
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS is_training_mode BOOLEAN DEFAULT false;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS score_display_type TEXT DEFAULT 'individual';
  -- Values: 'individual' (no aggregation), 'aggregate_3', 'aggregate_5'

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS max_judges INTEGER DEFAULT 100;
```

Or create a new `mode` column for clarity:

```sql
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS session_mode TEXT DEFAULT 'certification';
  -- Values: 'certification' (検定モード), 'tournament' (大会モード), 'training' (研修モード)
```

### 2. Scoring Logic Changes

**Current Competition Mode** (in tournament-events/[eventId]/score/status/+page.server.ts):
```typescript
if (sessionData.exclude_extremes) {
  // 5審3採: Calculate from middle 3 scores
  const scoreValues = scores.map(s => s.score).sort((a, b) => a - b);
  const middleThree = scoreValues.slice(1, 4);
  finalScore = middleThree.reduce((sum, s) => sum + s, 0);
}
```

**New Training Mode Logic**:
```typescript
// Don't aggregate - store and display individual scores
// Each judge's score stored separately in results table
// No aggregation calculation needed
// Scoreboard shows:
// - Bib number
// - Judge1: Score1, Judge2: Score2, Judge3: Score3, ..., Judge100: Score100
```

### 3. UI/Routing Changes

#### Option A: Separate Training Routes (Recommended)

```
/session/[id]/
├── training-setup/                (Training-specific setup)
│   ├── +page.svelte              (Setup overview)
│   ├── events/                   (Event management - same as tournament)
│   ├── judges/                   (Judge count configuration - NEW)
│   └── participants/             (Athlete registration - same as tournament)
├── training-events/              (Training scoring phase)
│   ├── +page.svelte              (Event selection - chief judge only)
│   └── [eventId]/score/
│       ├── +page.svelte          (Bib number input)
│       ├── status/               (Individual score display - NEW)
│       │   └── +page.svelte      (Show all judges' scores without aggregation)
│       └── complete/             (Score finalization)
└── training-scoreboard/          (Individual score display)
    └── +page.svelte              (Show raw judge scores, no ranking)
```

#### Option B: Unified Routes with Conditional Logic (Simpler)

Keep existing tournament routes and add conditionals:

```typescript
// In tournament-events/[eventId]/score/status/+page.server.ts

if (sessionData.is_training_mode) {
  // Don't aggregate - return all individual scores
  return {
    sessionDetails,
    customEvent,
    bib,
    scores: scores,  // Return all scores without aggregation
    isTrainingMode: true
  };
} else {
  // Existing tournament logic with aggregation
}
```

### 4. Scoreboard Display Changes

**Current Tournament Scoreboard** (scoreboard/[sessionId]/+page.server.ts):
```typescript
// Aggregates scores per bib
bibScores.set(bib, { total: aggregatedScore, events: {...} });

// Rankings calculated
const overallRanking = [...].sort((a, b) => b.total_score - a.total_score);
```

**Training Scoreboard**:
```typescript
// Store individual judge scores
const judgeScores = {
  bib: {
    event1: {
      judge1: score1,
      judge2: score2,
      ...
      judge100: score100
    }
  }
};

// NO ranking calculation
// Display as table: Bib | Judge1 | Judge2 | Judge3 | ... | Judge100
```

### 5. Implementation Phases

#### Phase 1: Core Infrastructure
- [ ] Add database columns (is_training_mode, max_judges)
- [ ] Update session creation form to include training mode option
- [ ] Create training-setup routes (reuse tournament-setup logic)
- [ ] Update session routing logic to handle three modes

#### Phase 2: Scoring Logic
- [ ] Modify score finalization to skip aggregation for training mode
- [ ] Update score display to show individual scores
- [ ] Implement max_judges validation

#### Phase 3: Results Display
- [ ] Create training-specific scoreboard
- [ ] Display individual judge scores in table format
- [ ] Add export functionality for training results

#### Phase 4: Testing & Refinement
- [ ] Test with various judge counts (3, 5, 50, 100)
- [ ] Performance testing with large result sets
- [ ] UI/UX refinement

---

## Code Examples for Implementation

### Example 1: Conditional Scoring in +page.server.ts

```typescript
// File: src/routes/session/[id]/[discipline]/[level]/[event]/score/status/+page.server.ts

export const actions: Actions = {
  finalizeScore: async ({ request, params, locals: { supabase } }) => {
    const { data: sessionData } = await supabase
      .from('sessions')
      .select('*')
      .eq('id', sessionId)
      .single();

    if (sessionData.is_training_mode) {
      // Training mode: No aggregation
      // Just redirect with all individual scores
      throw redirect(
        303,
        `/session/${sessionId}/training-events/${eventId}/score/complete?bib=${bib}&displayMode=individual`
      );
    } else if (sessionData.is_tournament_mode) {
      // Tournament mode: Existing aggregation logic
      let finalScore = 0;
      if (sessionData.exclude_extremes) {
        // 5審3採 logic
      } else {
        // 3審3採 logic
      }
      throw redirect(303, `...?score=${finalScore}`);
    }
  }
};
```

### Example 2: Training Scoreboard Display

```typescript
// File: src/routes/session/[id]/training-scoreboard/+page.server.ts

if (!sessionDetails.is_training_mode) {
  throw error(400, 'スコアボードはトレーニングモードでのみ利用できます。');
}

const results = await supabase
  .from('results')
  .select('*')
  .eq('session_id', sessionId);

// Organize by bib and judge
const scoresByBibAndJudge = {};
results.forEach(result => {
  if (!scoresByBibAndJudge[result.bib]) {
    scoresByBibAndJudge[result.bib] = {};
  }
  if (!scoresByBibAndJudge[result.bib][result.event_name]) {
    scoresByBibAndJudge[result.bib][result.event_name] = {};
  }
  scoresByBibAndJudge[result.bib][result.event_name][result.judge_name] = result.score;
});

return {
  sessionDetails,
  scoresByBibAndJudge,  // No aggregation
  events
};
```

### Example 3: Training Scoreboard UI

```svelte
<!-- File: src/routes/session/[id]/training-scoreboard/+page.svelte -->

<table class="scores-table">
  <thead>
    <tr>
      <th>ゼッケン</th>
      <th>種目</th>
      {#each judgeNames as judgeName}
        <th>{judgeName}</th>
      {/each}
    </tr>
  </thead>
  <tbody>
    {#each Object.entries(data.scoresByBibAndJudge) as [bib, events]}
      {#each Object.entries(events) as [eventName, judgeScores]}
        <tr>
          <td>{bib}番</td>
          <td>{eventName}</td>
          {#each judgeNames as judgeName}
            <td>{judgeScores[judgeName] || '-'}点</td>
          {/each}
        </tr>
      {/each}
    {/each}
  </tbody>
</table>
```

---

## Migration Strategy

### Step 1: Backward Compatibility
Keep all existing tournament mode code unchanged. Add training mode as a separate code path.

### Step 2: Feature Parity
Ensure training mode has same event/participant management as tournament mode.

### Step 3: Gradual Rollout
- Release training mode as beta
- Collect user feedback
- Refine based on usage patterns

### Step 4: Long-term
Consider consolidating code paths if patterns emerge.

---

## Key Differences Summary

| Aspect | Certification | Tournament | Training |
|--------|---------------|-----------|----------|
| **Max Judges** | 3-5 | 3-5 | 3-100 |
| **Scoring** | Average of all | 3審3採 or 5審3採 | Individual scores |
| **Aggregation** | Yes (average) | Yes (sum with extremes) | None |
| **Scoreboard** | N/A | Rankings | Judge comparison |
| **Chief Judge** | Yes | Yes | Yes |
| **Display Type** | N/A | Aggregate | Individual |
| **Use Case** | Certification | Competition | Training/Evaluation |

---

## Testing Checklist

- [ ] Create training mode session
- [ ] Add 100 judges to session
- [ ] Configure events
- [ ] Score with 3 judges
- [ ] Score with 50 judges
- [ ] Score with 100 judges
- [ ] Verify no aggregation in results
- [ ] Verify scoreboard displays all judge scores
- [ ] Test export functionality
- [ ] Performance test with large dataset

---

## Next Steps

1. Review this guide with the team
2. Create database migration for new columns
3. Implement Phase 1 (Core Infrastructure)
4. Create feature branch for training-mode implementation
5. Set up review process for new routes/logic
6. Plan beta release timeline

