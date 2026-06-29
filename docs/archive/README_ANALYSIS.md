# Codebase Analysis Summary

This directory contains comprehensive analysis documents for understanding the judge-app's competition mode implementation and planning for a training mode feature.

## Documents Included

### 1. COMPETITION_MODE_ANALYSIS.md (Main Document)
**Comprehensive 9-section analysis** covering:
- Overall architecture and session types
- Competition mode structure and implementation
- Judge (検定員) management with chief judge pattern
- Scoring implementation (3審3採 and 5審3採)
- Events/categories configuration
- Overall architecture and file structure
- Key design patterns
- Current judge limits
- Roadmap for training mode
- Complete file reference summary

**Read this first** for a complete understanding of how the system works.

### 2. TRAINING_MODE_IMPLEMENTATION_GUIDE.md
**Practical implementation roadmap** including:
- Quick reference for current competition mode
- Proposed training mode architecture
- Database schema changes
- Scoring logic modifications
- UI/routing options (Option A: Separate routes vs Option B: Conditional logic)
- Scoreboard display changes
- 4-phase implementation plan
- Code examples for key components
- Migration strategy
- Testing checklist
- Next steps

**Use this** to plan and execute the training mode feature.

### 3. QUICK_REFERENCE.md
**Fast lookup guide** providing:
- File structure summary
- Core data flow diagrams
- Key scoring logic locations
- Database table definitions
- Authorization patterns
- Polling and real-time updates
- Scoreboard logic explanation
- Training mode changes summary
- Testing key flows
- Quick grep commands

**Use this** during development for quick answers.

## Key Findings

### Current Architecture
- Single **chief judge (主任検定員)** per session
- Two scoring methods: **3審3採** (3 judges) and **5審3採** (5 judges with extremes excluded)
- **Custom events** configuration with flexible naming
- **Real-time score status** via polling (3-second intervals)
- **Public scoreboard** with participant rankings
- Separate database tables for tournament mode (custom_events, participants)

### Scoring Logic
- **3審3採**: Sum of 3 judge scores
- **5審3採**: Remove highest and lowest scores, sum middle 3
- Aggregation happens during score finalization, not during storage
- Each judge's individual score stored in results table

### Judge Management
- **Chief Judge**: Controls entire session (select events, input bibs, finalize scores)
- **Regular Judges**: Score when prompted, see waiting screen
- **Role is dynamic**: Can appoint/remove chief judge at any time
- No built-in judge count limits (database capacity only)

### Tournament Setup Flow
1. Create session with tournament mode
2. Configure events (custom categories)
3. Select scoring method (3-3 or 5-3)
4. Optionally register participants (athletes/teams)

## Implementation Priorities for Training Mode

### High Priority
1. Add database columns (is_training_mode, max_judges)
2. Update session creation UI to include training mode
3. Implement conditional scoring logic (aggregate vs individual)
4. Create training-specific scoreboard display

### Medium Priority
1. Separate training routes (recommended but optional)
2. Training-specific setup page with judge count configuration
3. Export functionality for training results

### Low Priority
1. UI refinements based on user feedback
2. Performance optimizations for large judge counts
3. Advanced analytics for training data

## File Dependencies Map

### Core Files (Must Understand)
```
1. database/migrations/001_add_tournament_mode.sql
   ↓ (defines schema)
   
2. src/routes/session/create/+page.server.ts
   ↓ (creates session, routes to setup)
   
3. src/routes/session/[id]/tournament-setup/scoring/+page.server.ts
   ↓ (sets exclude_extremes flag)
   
4. src/routes/session/[id]/tournament-events/[eventId]/score/status/+page.server.ts
   ↓ (implements 3審3採 / 5審3採 logic - MOST IMPORTANT)
   
5. src/routes/session/[id]/scoreboard/+page.server.ts
   ↓ (displays aggregated results)
```

### Supporting Files
- Chief judge management: `/session/[id]/details/+page.server.ts`
- Event management: `/tournament-setup/events/+page.server.ts`
- Real-time status: `/api/score-status/[sessionId]/[bib]/+server.ts`
- Public scoreboard: `/scoreboard/[sessionId]/+page.server.ts`

## Quick Implementation Checklist

### For Training Mode MVP
```
Phase 1: Infrastructure (1-2 days)
[ ] Add is_training_mode to sessions table
[ ] Add mode selection to session creation form
[ ] Create training-setup route (copy tournament-setup structure)
[ ] Update session routing logic to handle training mode

Phase 2: Scoring (1-2 days)
[ ] Modify score finalization to skip aggregation
[ ] Add conditional logic: if training_mode, skip calculate middle 3
[ ] Update score display to show all individual scores

Phase 3: Results (1 day)
[ ] Create training-scoreboard (no ranking, just scores)
[ ] Format as table: Bib | Judge1 | Judge2 | ... | Judge100
[ ] Test with various judge counts

Phase 4: Polish (1 day)
[ ] Update UI labels/descriptions
[ ] Add help text explaining training mode differences
[ ] Performance testing with large datasets
```

## Database Migration Template

```sql
-- Add training mode support
ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS is_training_mode BOOLEAN DEFAULT false;

ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS max_judges INTEGER DEFAULT 100;

-- Optional: consolidate into single mode column
-- ALTER TABLE sessions
--   ADD COLUMN IF NOT EXISTS session_mode TEXT DEFAULT 'certification'
--   CHECK (session_mode IN ('certification', 'tournament', 'training'));
```

## Testing Scenarios

### Must Test Before Release
1. Create training session with 3 judges - verify no aggregation
2. Create training session with 100 judges - verify all scores displayed
3. Change judge count during session - verify UI updates
4. Export training results - verify all judge scores included
5. Public scoreboard access - verify read-only display works
6. Compare with tournament mode - verify aggregation still works correctly

## Common Questions

**Q: Why is there a chief judge?**
A: Chief judge controls the flow - selects events, inputs bib numbers, reviews and finalizes scores. This prevents multiple people from entering conflicting bibs or finalizing simultaneously.

**Q: Why 3審3採 and 5審3採?**
A: 3-3 uses all 3 judges, 5-3 uses only middle 3 (removes extremes to avoid bias). Common in Japanese judged sports.

**Q: Can we remove the aggregation completely for tournament mode?**
A: Not recommended. Would break existing tournaments. Better to add as separate training mode.

**Q: How are scores stored individually?**
A: Each judge-athlete-event combination is a separate row in the results table. Aggregation happens during finalization (before display).

**Q: Do we need to change the results table?**
A: No. It already stores individual judge scores. Just skip the aggregation step for training mode.

## Related Documentation

- Database schema: See section 1 of COMPETITION_MODE_ANALYSIS.md
- Scoring implementation: See section 3 of COMPETITION_MODE_ANALYSIS.md
- Code examples: See section 6 of TRAINING_MODE_IMPLEMENTATION_GUIDE.md
- Quick grep commands: See end of QUICK_REFERENCE.md

## Additional Resources

- Supabase Docs: https://supabase.com/docs
- SvelteKit Docs: https://kit.svelte.dev/docs
- Project Plan: See Plan.md in project root

---

**Last Updated**: November 1, 2024
**Analysis Created**: Based on feature branch analysis
**Analyst Notes**: All file paths are absolute and verified. Code snippets are exact from source.
