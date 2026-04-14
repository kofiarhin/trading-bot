# Trading Bot v2 Implementation Spec

## Goal

Implement a full selection-intelligence pipeline: scan → pre-filter →
score → shortlist → strategy confirm → risk → execute

------------------------------------------------------------------------

## Phases

### Phase 1 --- Config Normalization

-   Centralize env config
-   Support legacy aliases
-   Standardize naming

### Phase 2 --- Pre-Filter Engine

Create `preFilter.js`: - Reject weak environments early - Return
structured metrics

### Phase 3 --- Strategy Refactor

Refactor `evaluateBreakout`: - Accept precomputed metrics - Focus only
on entry confirmation

### Phase 4 --- Scoring Engine

Extract scoring: - Return score + breakdown - Persist score breakdown

### Phase 5 --- Autopilot Pipeline

Refactor cycle: - Pre-filter all symbols - Score viable ones - Shortlist
top N - Run strategy only on shortlist

### Phase 6 --- Cycle Scoping

Add to Decision model: - cycleId - stage - rank - shortlisted -
rankedOut

### Phase 7 --- Analytics Upgrade

Expose: - prefilter vs strategy rejection - shortlist conversion - score
distribution

### Phase 8 --- Dashboard Cleanup

-   Use repo layer consistently

### Phase 9 --- Frontend Updates

-   Show shortlist vs ranked-out
-   Add stage badges
-   Add score breakdown UI

### Phase 10 --- Testing

Add tests for: - preFilter - scoring - pipeline - analytics - config
aliases

------------------------------------------------------------------------

## Success Criteria

Each cycle must answer: - how many scanned - how many prefiltered - how
many shortlisted - how many approved - how many placed

------------------------------------------------------------------------

## Final Outcome

System evolves from: "evaluate everything" to "select best opportunities
only"
