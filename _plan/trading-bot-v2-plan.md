# Trading Bot v2 — Full Implementation Plan

## Overview

This plan covers all 10 phases of the v2 spec. The goal is to transform the autopilot pipeline
from "evaluate everything sequentially" into a tiered selection pipeline:

```
scan → pre-filter → score → shortlist → strategy confirm → risk → execute
```

Each phase below lists the files to create/modify, the exact changes, and any schema migrations
required. Phases build on each other; implement them in order.

---

## Current State Summary

| What exists | Where |
|---|---|
| Config validation | `src/config/env.js` — validates required vars, exports typed config |
| Strategy + scoring | `src/strategies/breakoutStrategy.js` — `evaluateBreakout()` + `computeScore()` co-located |
| Pre-filter checks | Embedded inside `evaluateBreakout()` — early returns mixed with signal logic |
| Decision model | `src/models/Decision.js` — has `setupScore`, `setupGrade`, `rejectionClass`, `metrics` |
| Autopilot pipeline | `src/autopilot.js` — runs full `evaluateBreakout()` on every symbol |
| Analytics | `src/repositories/analyticsRepo.mongo.js` — rejection stats, candidate queries |
| Ranking | Inside autopilot — approved decisions sorted by `setupScore`, top N sliced |
| Frontend | React dashboard polling API every 15s; no score breakdown UI yet |

Key gap: every symbol goes through the full strategy evaluation before any filtering or scoring
happens at the pipeline level. Pre-filter logic, scoring, and strategy confirmation are all
entangled inside `evaluateBreakout()`.

---

## Phase 1 — Config Normalization

**Goal:** One central config module all files import. Legacy env-var aliases resolved transparently.

### Files to change

#### `src/config/env.js` (modify)

Add an alias resolution block before the exports. Map old names → new canonical names so existing
`.env` files keep working without changes.

```
Legacy alias map:
  SYMBOLS           → AUTOPILOT_SYMBOLS
  WATCHLIST         → AUTOPILOT_SYMBOLS
  TICKERS           → AUTOPILOT_SYMBOLS
  RISK_PER_TRADE    → RISK_PERCENT
  MAX_OPEN_POSITIONS → MAX_POSITIONS
  LOSS_LIMIT_PCT    → DAILY_LOSS_LIMIT_PCT
  SCORE_THRESHOLD   → MIN_SETUP_SCORE
```

Implementation steps:
1. Before reading `process.env` fields, loop over the alias map: if the legacy key is set and
   the canonical key is NOT set, copy the value across.
2. Add a `resolvedAliases` array to the exported config so other modules (and tests) can inspect
   which aliases were applied.
3. Standardize all config field names in the export to camelCase (existing fields are already
   camelCase — just ensure consistency for new fields added in later phases).
4. Export a new `CONFIG_VERSION = "v2"` constant so the dashboard can show which config schema
   is active.

#### `.env.example` (modify)

Add a "Legacy aliases (deprecated)" section listing all old names with `# DEPRECATED → use X`
comments. Do not remove existing canonical keys.

#### No other files need to change in Phase 1

The alias resolution happens at module load time inside `env.js`, so all existing imports of
`src/config/env.js` automatically get normalized values.

---

## Phase 2 — Pre-Filter Engine

**Goal:** Fast, cheap rejection of symbols before the full strategy runs. Returns structured
metrics that Phase 3 can reuse, so indicators are never computed twice.

### New file: `src/preFilter.js`

```
Export: preFilter(symbol, assetClass, bars, config) → PreFilterResult
```

**PreFilterResult shape:**
```js
{
  symbol: String,
  assetClass: String,
  passed: Boolean,
  rejectReason: String | null,     // null if passed
  rejectStage: "pre_filter" | null,
  metrics: {
    closePrice: Number,
    highestHigh: Number,           // 20-candle lookback
    atr: Number,                   // 14-period ATR
    volumeRatio: Number,           // current / 20-candle average
    distanceToBreakoutPct: Number, // (closePrice - highestHigh) / highestHigh * 100
    barCount: Number               // bars available
  } | null                         // null if data checks failed
}
```

**Pre-filter checks (in order):**

| Check | Reject reason | Condition |
|---|---|---|
| Minimum bar count | `insufficient_market_data` | bars.length < BREAKOUT_LOOKBACK + 2 |
| ATR floor | `atr_too_low` | atr < MIN_ATR (0.25) |
| Volume data present | `missing_volume` | no volume in bars |
| Volume ratio floor | `weak_volume` | volumeRatio < MIN_VOL_RATIO (1.2) |
| Not above breakout | `no_breakout` | closePrice <= highestHigh |
| Overextension ceiling | `overextended_breakout` | distanceToBreakoutPct > MAX_DISTANCE_TO_BREAKOUT_PCT |

These are the same checks currently inside `evaluateBreakout()`. Moving them here means:
- Symbols failing these checks are rejected before indicators are even fully computed.
- The metrics computed here (ATR, highestHigh, volumeRatio) are returned and passed directly into
  the strategy in Phase 3, eliminating redundant computation.
- Each rejection gets `rejectStage: "pre_filter"` for analytics differentiation from
  strategy-stage rejections.

**Implementation notes:**
- Import indicator functions from `src/indicators/` (atr, highestHigh, averageVolume).
- Do NOT import anything from `src/strategies/` — keep this module independent.
- `preFilter` must be a pure function (no DB calls, no side effects).

---

## Phase 3 — Strategy Refactor

**Goal:** `evaluateBreakout` accepts precomputed metrics from `preFilter`, focuses only on entry
confirmation logic (near-miss check, R:R validation, stop/target sizing, score gating).

### Files to change

#### `src/strategies/breakoutStrategy.js` (modify)

**Current signature:**
```js
evaluateBreakout({ symbol, assetClass, bars, accountEquity, riskPercent, ... })
```

**New signature:**
```js
evaluateBreakout({ symbol, assetClass, bars, preFilterMetrics, accountEquity, riskPercent, ... })
```

When `preFilterMetrics` is provided, skip recomputing ATR, highestHigh, volumeRatio, closePrice —
use the values from the pre-filter result directly.

**Checks that remain in `evaluateBreakout` (strategy-stage):**

| Check | Reject reason | Stage |
|---|---|---|
| Near-miss below level | `near_breakout` | `strategy` |
| Stop distance invalid | `invalid_stop_distance` | `strategy` |
| Weak R:R | `weak_risk_reward` | `strategy` |
| Invalid position size | `invalid_position_size` | `strategy` |
| Score below threshold | `score_below_threshold` | `strategy` |

**Checks that move to preFilter (delete from here):**
- `insufficient_market_data`
- `atr_too_low`
- `missing_volume`
- `weak_volume`
- `no_breakout`
- `overextended_breakout`

Add a `rejectStage` field to the returned decision:
- `"pre_filter"` — set by preFilter, passed through (autopilot will set this)
- `"strategy"` — set here when strategy-stage checks fail
- `null` — approved

**Backward compatibility:** If `preFilterMetrics` is not provided (e.g., old callers), fall back
to computing metrics internally. This prevents breaking the manual `forceTrade` path.

---

## Phase 4 — Scoring Engine

**Goal:** Extract `computeScore()` into a standalone module. Return full breakdown per component
so the breakdown can be stored and displayed.

### New file: `src/scoring/scorer.js`

```
Export: computeScore(metrics, config) → ScoreResult
```

**ScoreResult shape:**
```js
{
  total: Number,           // 0-100 composite
  grade: String,           // "A" | "B" | "C"
  breakdown: {
    momentum: Number,      // 0-25 (distance to breakout)
    volume: Number,        // 0-25 (volume ratio vs avg)
    atrQuality: Number,    // 0-25 (ATR as % of price, optimal band)
    riskReward: Number,    // 0-25 (R:R ratio, ceiling 4.0)
  }
}
```

**Grade thresholds** (same as current):
- A: total >= 75
- B: total >= 50
- C: total < 50

**Implementation notes:**
- Pure function — no imports from strategies, no DB calls.
- The 4 component functions that currently live inline in `breakoutStrategy.js` move here.
- `breakoutStrategy.js` imports from `src/scoring/scorer.js` instead of defining locally.
- The `breakdown` object is passed into the Decision record (see Phase 6 schema addition).

### `src/strategies/breakoutStrategy.js` (modify)

Replace the inline `computeScore()` definition with an import from `src/scoring/scorer.js`.
Pass `scoreResult.breakdown` through to the returned decision object.

### `src/models/Decision.js` (modify)

Add `scoreBreakdown` field:
```js
scoreBreakdown: {
  momentum: Number,
  volume: Number,
  atrQuality: Number,
  riskReward: Number,
}
```

### `src/repositories/decisionRepo.mongo.js` (modify)

Update `saveDecision()` to persist `scoreBreakdown` when present.

---

## Phase 5 — Autopilot Pipeline Refactor

**Goal:** The pipeline runs pre-filter on ALL symbols first, then scores viable ones, then
shortlists top N, then runs strategy only on shortlisted symbols.

### `src/autopilot.js` (modify — core change)

**Current flow (per-symbol sequential):**
```
For each symbol:
  1. Fetch bars
  2. evaluateBreakout() — does everything
  3. Record decision
```

**New flow (batched tiers):**
```
Phase A — Fetch all bars (batch)
Phase B — Pre-filter all symbols (batch, pure)
Phase C — Score viable symbols (batch, pure)
Phase D — Shortlist top N (sort + slice)
Phase E — Run evaluateBreakout() on shortlist only (strategy confirm)
Phase F — Risk guards on approved candidates (unchanged)
Phase G — Place orders (unchanged)
```

**Detailed implementation:**

#### Phase A — Fetch bars
No change to existing `getBarsForSymbols()` / `fetchCryptoBars()` calls. Collect results into
a `barsMap: Map<symbol, bars[]>`.

#### Phase B — Pre-filter (new stage: `PRE_FILTERING`)
```js
const preFilterResults = symbols.map(sym =>
  preFilter(sym, assetClass, barsMap.get(sym), config)
);
const viable = preFilterResults.filter(r => r.passed);
const preFiltered = preFilterResults.filter(r => !r.passed);
```

For each rejected symbol: record a Decision doc with `approved: false`, `rejectStage: "pre_filter"`,
`stage: "pre_filter"`, `shortlisted: false`.

Update `CYCLE_STAGES` to include `PRE_FILTERING` between `FETCHING_MARKET_DATA` and `EVALUATING_SIGNALS`.

#### Phase C — Score viable symbols
```js
const scored = viable.map(r => ({
  ...r,
  scoreResult: computeScore(r.metrics, config)
}));
```

Pure scoring pass — no DB writes yet. Results used for shortlisting.

#### Phase D — Shortlist top N
```js
const shortlist = scored
  .sort((a, b) => b.scoreResult.total - a.scoreResult.total)
  .slice(0, MAX_CANDIDATES_PER_CYCLE);
const rankedOut = scored.slice(MAX_CANDIDATES_PER_CYCLE);
```

Record Decision docs for ranked-out symbols with `approved: false`, `rejectStage: "ranked_out"`,
`shortlisted: false`, `rankedOut: true`, `rank: N` (their rank position).

#### Phase E — Strategy confirm on shortlist
```js
for (const item of shortlist) {
  const decision = await evaluateBreakout({
    symbol: item.symbol,
    preFilterMetrics: item.metrics,   // reuse precomputed values
    bars: barsMap.get(item.symbol),
    accountEquity,
    riskPercent,
    ...
  });
  // record decision with shortlisted: true, rank: item.rank
}
```

#### Existing Phases F and G — unchanged
Risk guard evaluation and order placement remain the same.

### New cycle stages to add in `src/autopilot/cycleStages.js`

Add between `FETCHING_MARKET_DATA` and `EVALUATING_SIGNALS`:
- `PRE_FILTERING: "pre_filtering"` — 38%
- `SCORING_CANDIDATES: "scoring_candidates"` — 44%
- `SHORTLISTING: "shortlisting"` — 50%

Renumber existing stages proportionally:
- `EVALUATING_SIGNALS` → 56%
- `RANKING_CANDIDATES` → 62% (now only re-sorts strategy-confirmed candidates)
- `APPLYING_RISK_GUARDS` → 70%
- `PLACING_ORDERS` → 80%
- `FINAL_SYNC` → 90%
- `COMPLETED` → 100%

---

## Phase 6 — Cycle Scoping

**Goal:** Every Decision document links back to its cycle and carries pipeline placement metadata.

### `src/models/Decision.js` (modify)

Add fields:
```js
cycleId:     { type: String, index: true },  // links to CycleRuntime.cycleId
stage:       { type: String },               // "pre_filter" | "scored" | "shortlisted" | "strategy" | "risk" | "execution"
rank:        { type: Number },               // numeric rank (1 = best score); null if pre-filtered out
shortlisted: { type: Boolean, default: false },
rankedOut:   { type: Boolean, default: false },
```

Add compound index: `{ cycleId: 1, shortlisted: 1 }` for dashboard queries.

### `src/autopilot.js` (modify)

Populate `cycleId` on every `Decision` record created in the cycle. This already exists as a
local variable (`cycleId`) in `runAutopilotCycle()` — just pass it through to `recordDecision()`.

Update `recordDecision()` to accept and persist all four new fields.

### `src/repositories/decisionRepo.mongo.js` (modify)

Add query helper:
```js
getDecisionsForCycle(cycleId) → Decision[]  // sorted by rank asc, then timestamp
getShortlistForCycle(cycleId) → Decision[]  // shortlisted: true only
```

### `src/models/CycleRuntime.js` (modify)

Add summary counters:
```js
preFiltered:  Number,   // count rejected at pre-filter stage
shortlisted:  Number,   // count that made the shortlist
rankedOut:    Number,   // count scored but not shortlisted
```

Update `startCycleRuntime`, `updateCycleRuntime`, `completeCycleRuntime` in
`src/repositories/cycleRuntimeRepo.mongo.js` to carry these new counters.

---

## Phase 7 — Analytics Upgrade

**Goal:** Expose pre-filter vs strategy rejection breakdown, shortlist conversion rates, and score
distribution.

### `src/repositories/analyticsRepo.mongo.js` (modify)

Add / update these query functions:

#### `getRejectionStats(days, topN)` — extend existing

Add new breakdown group:
```js
byStage: {
  pre_filter: Number,    // rejected at pre-filter
  strategy:   Number,    // rejected at strategy confirm
  ranked_out: Number,    // passed pre-filter + score, not shortlisted
  risk_guard: Number,    // blocked by execution/portfolio guards
}
```

#### New: `getShortlistConversionStats(days)` → ConversionStats
```js
{
  totalScanned:     Number,
  preFilterPassed:  Number,
  shortlisted:      Number,
  strategyApproved: Number,
  riskApproved:     Number,
  placed:           Number,
  // conversion rates (0-1)
  preFilterRate:     Number,   // preFilterPassed / totalScanned
  shortlistRate:     Number,   // shortlisted / preFilterPassed
  approvalRate:      Number,   // strategyApproved / shortlisted
  placementRate:     Number,   // placed / riskApproved
}
```

#### New: `getScoreDistribution(days)` → ScoreDistribution
```js
{
  buckets: [
    { range: "0-24",  count: Number },
    { range: "25-49", count: Number },
    { range: "50-74", count: Number },
    { range: "75-100", count: Number },
  ],
  mean:   Number,
  median: Number,
  p90:    Number,
}
```
Query from `Decision` where `setupScore != null` and `date >= N days ago`.

### `src/server/routes/rejections.js` (modify)

The existing `GET /api/rejections` route calls `getRejectionStats`. Update response to include
the new `byStage` breakdown.

### New route: `src/server/routes/analytics.js`

```
GET /api/analytics/conversion?days=7   → ShortlistConversionStats
GET /api/analytics/scores?days=7       → ScoreDistribution
```

Register in `src/server/index.js`.

---

## Phase 8 — Dashboard Cleanup

**Goal:** All server route handlers go through the repository layer. No direct Mongoose model
imports in route files.

### Audit (check each file)

| Route file | Current pattern | Action |
|---|---|---|
| `src/server/routes/dashboard.js` | May query models directly | Route through `analyticsRepo` / `cycleRuntimeRepo` |
| `src/server/routes/candidates.js` | Calls `getCandidatesForCycle` from `analyticsRepo` | Already correct |
| `src/server/routes/rejections.js` | Calls `getRejectionStats` from `analyticsRepo` | Already correct |
| `src/server/routes/trades.js` | May query `OpenTrade`/`ClosedTrade` directly | Route through `tradeJournalRepo` |
| `src/server/routes/journal.js` | May query `JournalRecord` directly | Route through `tradeJournalRepo` |

### For each route that queries models directly:

1. Add the corresponding query to the appropriate repo file if it doesn't exist.
2. Replace the direct model import with a repo import in the route file.
3. Do not change the response shape — frontend must not break.

---

## Phase 9 — Frontend Updates

### 9a — Shortlist vs Ranked-Out Display

**File:** `client/src/services/dashboard.js` — add `getCandidatesForCycle(cycleId)` call
(already exists as `/api/candidates?cycleId=`).

**File:** `client/src/hooks/queries/useDashboard.js` (or create `useCandidates.js`)

Add a React Query hook:
```js
useCandidatesForCycle(cycleId) {
  queryKey: ['candidates', cycleId],
  queryFn: () => getCandidatesForCycle(cycleId),
  staleTime: 10_000,
  refetchInterval: 15_000,
}
```

**New component:** `client/src/components/CandidateList.jsx`

Renders a table with columns:
- Symbol
- Rank
- Score (with grade badge: A/B/C)
- Stage badge (pre_filter / shortlisted / strategy / risk)
- Reason (if rejected)
- Entry / Stop / Target (if shortlisted)

Group rows by pipeline outcome: shortlisted | ranked-out | pre-filtered.

### 9b — Stage Badges

**New component:** `client/src/components/StageBadge.jsx`

Color-coded pill badges:
- `pre_filter` → gray
- `shortlisted` → blue
- `strategy` → yellow
- `approved` → green
- `risk_guard` → orange
- `ranked_out` → slate

Used in `CandidateList` and anywhere decisions are shown.

### 9c — Score Breakdown UI

**New component:** `client/src/components/ScoreBreakdown.jsx`

Renders the 4 breakdown components as small horizontal bar segments:
```
Momentum   ████████░░  18/25
Volume     ██████░░░░  14/25
ATR        █████████░  22/25
R:R        ████████░░  20/25
─────────────────────
Total      89/100  Grade: A
```

Used inside `CandidateList` row expand or tooltip.

### 9d — Conversion Funnel (optional but recommended)

**New component:** `client/src/components/ConversionFunnel.jsx`

Displays the `ShortlistConversionStats` as a funnel:
```
Scanned (28) → Pre-filtered (12) → Shortlisted (3) → Approved (2) → Placed (1)
```

Uses `/api/analytics/conversion?days=7`.

### Service additions

`client/src/services/analytics.js` (new file):
```js
getConversionStats(days)   → GET /api/analytics/conversion
getScoreDistribution(days) → GET /api/analytics/scores
```

---

## Phase 10 — Testing

All tests go under `tests/` (Jest + Supertest, ES modules).

### 10a — `tests/preFilter/preFilter.test.js`

Test cases:
- Pass: symbol with 30 bars, volumeRatio 1.5, ATR 0.8, closePrice above highestHigh
- Fail: insufficient bars (< BREAKOUT_LOOKBACK + 2)
- Fail: atr below MIN_ATR (0.25)
- Fail: missing volume data
- Fail: weak volume (volumeRatio < 1.2)
- Fail: no breakout (closePrice <= highestHigh)
- Fail: overextended (distanceToBreakoutPct > MAX_DISTANCE_TO_BREAKOUT_PCT)
- Pass: verify metrics object is fully populated on pass
- Pass: verify metrics is null on data-check fail (no bars)

### 10b — `tests/scoring/scorer.test.js`

Test cases:
- Perfect score (all 4 components max): verify total = 100, grade = "A"
- Zero score: verify total = 0, grade = "C"
- Grade boundary: score = 75 → "A"; score = 74 → "B"; score = 50 → "B"; score = 49 → "C"
- Momentum component: distance = 0 → 25pts; distance = maxPct → 0pts
- Volume component: volumeRatio = 3.0 → 25pts; volumeRatio = 1.2 → 10pts
- ATR quality component: in optimal band (0.5%-2%) → 25pts; very low ATR → 0pts
- R:R component: riskReward = 4.0 → 25pts; riskReward = minRiskReward → 0pts

### 10c — `tests/pipeline/autopilot.integration.test.js`

Use `mongodb-memory-server` for in-process MongoDB.

Test cases:
- Full dry-run cycle: mock `getBarsForSymbols` to return fixture bars, verify:
  - Pre-filter results recorded as Decisions with `rejectStage: "pre_filter"`
  - Ranked-out results recorded with `rankedOut: true`
  - Shortlisted results recorded with `shortlisted: true`
  - Only shortlisted symbols have `evaluateBreakout` called (spy on it)
  - `cycleId` is present on all Decision records
  - `CycleRuntime` final state has correct counters: scanned, preFiltered, shortlisted, placed
- Guard: symbol already open → `duplicate_position_guard` blocker recorded
- Guard: daily loss limit hit → cycle halted, 0 placements

### 10d — `tests/analytics/analyticsRepo.test.js`

Use `mongodb-memory-server`. Seed Decision documents with known data.

Test cases:
- `getShortlistConversionStats`: verify rates calculated correctly from seeded data
- `getScoreDistribution`: verify bucket counts and mean/median
- `getRejectionStats`: verify `byStage` breakdown totals match seeded rejections

### 10e — `tests/config/env.test.js`

Test cases:
- Legacy alias `SYMBOLS` → sets `AUTOPILOT_SYMBOLS`
- Legacy alias `RISK_PER_TRADE` → sets `RISK_PERCENT`
- Legacy alias does NOT override canonical key if both set
- `resolvedAliases` array lists applied aliases
- Missing required vars → throws on import (wrap in child_process spawn or jest isolation)

---

## Implementation Order & Dependencies

```
Phase 1  (config)        → No deps
Phase 2  (preFilter)     → Phase 1
Phase 3  (strategy)      → Phase 2
Phase 4  (scoring)       → Phase 3
Phase 5  (pipeline)      → Phases 2, 3, 4
Phase 6  (cycle scoping) → Phase 5
Phase 7  (analytics)     → Phase 6
Phase 8  (dashboard)     → Phase 7
Phase 9  (frontend)      → Phases 6, 7, 8
Phase 10 (tests)         → All phases
```

Phases 1–4 can be done incrementally without breaking the existing pipeline — they are additive
or self-contained refactors. Phase 5 is the breaking change to the pipeline flow; commit Phases
1–4 first and verify the bot still runs correctly before starting Phase 5.

---

## File Change Summary

| File | Action | Phase |
|---|---|---|
| `src/config/env.js` | Add alias resolution, `resolvedAliases`, `CONFIG_VERSION` | 1 |
| `.env.example` | Add deprecated alias comments | 1 |
| `src/preFilter.js` | **New** — pure pre-filter function | 2 |
| `src/strategies/breakoutStrategy.js` | Accept `preFilterMetrics`, remove pre-filter checks, import scorer | 3, 4 |
| `src/scoring/scorer.js` | **New** — extracted `computeScore()` with breakdown | 4 |
| `src/models/Decision.js` | Add `scoreBreakdown`, `cycleId`, `stage`, `rank`, `shortlisted`, `rankedOut` | 4, 6 |
| `src/repositories/decisionRepo.mongo.js` | Persist new fields, add `getDecisionsForCycle`, `getShortlistForCycle` | 4, 6 |
| `src/autopilot.js` | Refactor to batched pipeline, populate cycleId on decisions | 5, 6 |
| `src/autopilot/cycleStages.js` | Add `PRE_FILTERING`, `SCORING_CANDIDATES`, `SHORTLISTING` stages | 5 |
| `src/models/CycleRuntime.js` | Add `preFiltered`, `shortlisted`, `rankedOut` counters | 6 |
| `src/repositories/cycleRuntimeRepo.mongo.js` | Carry new counters | 6 |
| `src/repositories/analyticsRepo.mongo.js` | Add `byStage`, `getShortlistConversionStats`, `getScoreDistribution` | 7 |
| `src/server/routes/rejections.js` | Include `byStage` in response | 7 |
| `src/server/routes/analytics.js` | **New** — conversion and score endpoints | 7 |
| `src/server/index.js` | Register analytics routes | 7 |
| `src/server/routes/dashboard.js` | Use repo layer only | 8 |
| `src/server/routes/trades.js` | Use repo layer only | 8 |
| `src/server/routes/journal.js` | Use repo layer only | 8 |
| `client/src/services/analytics.js` | **New** — conversion + score API calls | 9 |
| `client/src/hooks/queries/useCandidates.js` | **New** — React Query hook | 9 |
| `client/src/components/CandidateList.jsx` | **New** — shortlist/ranked-out table | 9 |
| `client/src/components/StageBadge.jsx` | **New** — stage pill badge | 9 |
| `client/src/components/ScoreBreakdown.jsx` | **New** — score bar breakdown | 9 |
| `client/src/components/ConversionFunnel.jsx` | **New** — funnel chart | 9 |
| `tests/preFilter/preFilter.test.js` | **New** | 10 |
| `tests/scoring/scorer.test.js` | **New** | 10 |
| `tests/pipeline/autopilot.integration.test.js` | **New** | 10 |
| `tests/analytics/analyticsRepo.test.js` | **New** | 10 |
| `tests/config/env.test.js` | **New** | 10 |

---

## Success Criteria Verification

The spec requires each cycle to answer:

| Question | How it is answered after v2 |
|---|---|
| How many scanned? | `CycleRuntime.symbolCount` + `scanned` counter |
| How many pre-filtered? | `CycleRuntime.preFiltered` counter; Decisions with `rejectStage: "pre_filter"` |
| How many shortlisted? | `CycleRuntime.shortlisted` counter; Decisions with `shortlisted: true` |
| How many approved? | `CycleRuntime.approved` counter; Decisions with `approved: true` and no blockers |
| How many placed? | `CycleRuntime.placed` counter; TradeEvent `type: "trade_placed"` in CycleLog |

All five answers are available via `GET /api/cycle` (CycleRuntime) and `GET /api/dashboard`.
