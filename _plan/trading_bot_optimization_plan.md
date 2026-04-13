# Trading Bot Optimization — Implementation Plan

**Spec:** `_spec/trading_bot_optimization_spec.md`
**Date drafted:** 2026-04-13

---

## Overview

The current autopilot pipeline is:

```
scan → evaluateBreakout (approve/reject) → risk guards (per-trade) → place
```

The target pipeline is:

```
scan → score → rank → portfolio risk → execute top N → manage exits → measure → adapt
```

This plan is split into 8 phases. Each phase is independently shippable and builds on the previous one. Phases 1–4 are backend-only. Phase 5 is analytics infrastructure. Phase 6 adds API endpoints. Phase 7 enriches data persistence. Phase 8 is the frontend.

---

## Phase 1 — Strategy Scoring Layer

**Goal:** `breakoutStrategy.js` returns a numeric score and grade alongside its current approved/rejected result. Scoring enables ranking in Phase 2.

### What to change

**`src/strategies/breakoutStrategy.js`**
- Add a `computeScore(metrics, opts)` helper at the bottom of the file. Returns `{ score: number, setupGrade: "A"|"B"|"C", context: object }`.
- Score components (each 0–25, total 0–100):
  - **Momentum** (25): `distanceToBreakoutPct` normalized within `[0, maxDistanceToBreakoutPct]` — tighter breakout = higher score.
  - **Volume** (25): `volumeRatio` capped at 3× — higher ratio = higher score.
  - **ATR quality** (25): ATR relative to price (volatility rank) — mid-range ATR preferred.
  - **R:R** (25): `riskReward` normalized against `minRiskReward` ceiling of 4 — higher R:R = higher score.
- `setupGrade`: A ≥ 75, B ≥ 50, C < 50.
- `context` object: `{ session, volatilityLabel: "low"|"mid"|"high", trendLabel: "breakout" }`. Session is read from `src/utils/time.js` `resolveSession()`.
- `rejectionClass`: Map existing `reason` strings into categories — `"no_signal"` (no_breakout, breakout_too_extended), `"weak_conditions"` (weak_volume, atr_too_low), `"sizing_error"` (invalid_risk_reward, invalid_stop_distance, insufficient_market_data).
- Append `setupScore`, `setupGrade`, `rejectionClass`, and `context` to the returned decision object on both approved and rejected paths.

**`src/models/Decision.js`**
- Add fields: `setupScore: Number`, `setupGrade: String`, `rejectionClass: String`, `context: Mixed`.

**`src/autopilot.js` → `recordDecision()`**
- Pass `setupScore`, `setupGrade`, `rejectionClass`, `context` through to `saveDecision()`.

**`src/repositories/decisionRepo.mongo.js`**
- Accept and persist the new fields.

### Tests
- `tests/strategies/breakoutStrategy.scoring.test.js` — unit tests for `computeScore` covering edge cases (zero volume, max ATR, min R:R).

---

## Phase 2 — Candidate Ranking in Autopilot

**Goal:** Collect all approved decisions, rank by `setupScore`, execute only the top N candidates per cycle.

### What to change

**`src/autopilot.js`**
- After the `EVALUATING_SIGNALS` stage, collect all approved decisions into a `candidatePool` array.
- Sort `candidatePool` by `setupScore` descending.
- Slice to `MAX_CANDIDATES_PER_CYCLE` (new env var, default `3`).
- Only the sliced candidates proceed to `APPLYING_RISK_GUARDS` and `PLACING_ORDERS`.
- Decisions that were approved but cut by ranking get a new event type `candidate_ranked_out` with their score and rank.
- Log the ranked pool at `CYCLE_STAGES.EVALUATING_SIGNALS` completion.

**`.env.example`**
- Add `MAX_CANDIDATES_PER_CYCLE=3`.

**`src/autopilot/cycleStages.js`**
- Add `RANKING_CANDIDATES` stage between `EVALUATING_SIGNALS` and `APPLYING_RISK_GUARDS`.

### Tests
- `tests/autopilot/candidateRanking.test.js` — mock decisions with varying scores, assert only top N pass through.

---

## Phase 3 — Portfolio Risk Engine

**Goal:** Add portfolio-level risk controls: total open risk cap, correlation buckets (sector/asset class), drawdown throttling. These run after per-symbol guards.

### What to change

**New file: `src/risk/portfolioRisk.js`**

```js
// Exported functions:
export async function checkPortfolioRisk({ candidates, openTrades, brokerPositions, accountEquity, riskState })
// Returns { allowed: Candidate[], blocked: { candidate, reason }[] }
```

- **Total open risk cap**: Sum `riskAmount` of all current open trades + sum of candidates' `riskAmount`. Reject candidates that would push total above `MAX_TOTAL_RISK_PCT * accountEquity` (env var, default `5%`).
- **Correlation buckets**: Group symbols by `assetClass` (`stock` | `crypto`). Reject any candidate that would cause the portfolio to hold > `MAX_CORRELATED_POSITIONS` (env var, default `3`) in the same bucket.
- **Drawdown throttling**: Read `riskState.dailyRealizedLoss`. If daily loss > `DRAWDOWN_THROTTLE_PCT * accountEquity` (env var, default `1%`) but below the hard lock (`DAILY_LOSS_LIMIT_PCT`), halve `MAX_CANDIDATES_PER_CYCLE` (i.e., reduce position sizing aggressiveness before full lockout).

**`src/risk/guards.js`**
- No changes to existing per-trade guards.
- `portfolioRisk.js` is a separate layer called from autopilot after individual guards pass.

**`src/models/RiskState.js`**
- Add fields: `totalOpenRisk: Number`, `drawdownThrottleActive: Boolean`.

**`.env.example`**
- Add `MAX_TOTAL_RISK_PCT=5`, `MAX_CORRELATED_POSITIONS=3`, `DRAWDOWN_THROTTLE_PCT=1`.

**`src/autopilot.js`**
- After per-decision `evaluateExecutionGuards`, pass the full candidate pool through `checkPortfolioRisk` as a batch.
- Blocked candidates get event type `candidate_portfolio_blocked`.

### Tests
- `tests/risk/portfolioRisk.test.js` — test total risk cap, correlation bucket limit, drawdown throttle.

---

## Phase 4 — Exit Engine Enhancements

**Goal:** Extend exit logic beyond stop/take-profit to include breakeven, trailing stop, and time-based exits.

### What to change

**`src/models/OpenTrade.js`**
- Add fields:
  - `breakevenTriggered: { type: Boolean, default: false }`
  - `trailingStopPrice: Number`
  - `maxHoldBars: Number` (set at open time from env, default `48` = 12h at 15min)
  - `barsHeld: Number`

**New file: `src/positions/exitEngine.js`** (replaces raw logic in `positionMonitor.js`)

```js
export async function evaluateExits(openTrades, positionMap)
// Returns Array<{ tradeId, symbol, shouldExit, reason, currentPrice, updatedTrade }>
// reason: "stop_loss" | "take_profit" | "breakeven_stop" | "trailing_stop" | "time_exit"
```

- **Breakeven logic**: When `currentPrice >= entryPrice + 1 * riskPerUnit` and `!trade.breakevenTriggered`, set `stopLoss = entryPrice + buffer` (buffer = 0.1 * ATR if available, else 0), write `breakevenTriggered: true` back to `OpenTrade`. Do not exit — just update the stop level.
- **Trailing stop**: When `breakevenTriggered` and `currentPrice > trailingStopPrice`, update `trailingStopPrice = currentPrice - ATR_MULTIPLIER * atr`. Exit if `currentPrice <= trailingStopPrice`.
- **Time-based exit**: Increment `barsHeld` each cycle (already called per 15-min candle). If `barsHeld >= maxHoldBars`, exit with reason `time_exit`.
- `positionMonitor.js` delegates to `exitEngine.js` — it becomes a thin wrapper.

**`src/autopilot.js` → `handleExits()`**
- Switch from calling `checkOpenTradesForExit` directly to `evaluateExits`.
- Emit `trade_stop_updated` cycle event when breakeven/trailing stop levels change (no exit yet).

**`.env.example`**
- Add `MAX_HOLD_BARS=48`, `TRAILING_ATR_MULTIPLIER=1.5`.

### Tests
- `tests/positions/exitEngine.test.js` — unit test each exit path independently with mock trade + position data.

---

## Phase 5 — Analytics Layer

**Goal:** Compute expectancy, profit factor, win rate, and performance breakdowns from closed trades. These calculations are the foundation for the analytics API and dashboard.

### What to change

**New directory: `src/analytics/`**

**`src/analytics/performance.js`**

```js
export function computePerformance(closedTrades)
// Returns:
// {
//   totalTrades, wins, losses, winRate,
//   avgWinR, avgLossR, expectancy, profitFactor,
//   grossProfit, grossLoss, netPnl,
//   bySymbol: { [symbol]: { wins, losses, netPnl, winRate } },
//   bySession: { [session]: { wins, losses, netPnl } },
//   byGrade: { A: {...}, B: {...}, C: {...} }
// }
```

- Pure function — no DB calls. Takes an array of `ClosedTrade` documents.
- R multiple per trade = `(exitPrice - entryPrice) / riskPerUnit`. Store via Phase 7.
- Expectancy = `(winRate * avgWinR) - ((1 - winRate) * Math.abs(avgLossR))`.
- Profit factor = `grossProfit / Math.abs(grossLoss)`.

**`src/analytics/exposure.js`**

```js
export async function computeExposure({ openTrades, brokerPositions, accountEquity })
// Returns:
// {
//   totalOpenRisk, totalOpenRiskPct,
//   openPositionCount, unrealizedPnl,
//   byAssetClass: { stock: {...}, crypto: {...} }
// }
```

**`src/repositories/analyticsRepo.mongo.js`**
- `getClosedTradesForPeriod(days)` — fetch closed trades for the last N days.
- `getDecisionsForPeriod(days)` — for rejection analysis.
- `getCandidatesLastCycle()` — last cycle's approved decisions sorted by score.

### Tests
- `tests/analytics/performance.test.js` — unit tests with fixed trade arrays, assert exact expectancy/profit factor.

---

## Phase 6 — API Additions

**Goal:** Expose the five new analytics endpoints. All are read-only — consistent with the existing server design.

### New route files

**`src/server/routes/performance.js`** → `GET /api/performance`
- Query param: `?days=30` (default 30).
- Calls `analyticsRepo.getClosedTradesForPeriod(days)` → `computePerformance(trades)`.
- Returns performance object from Phase 5.

**`src/server/routes/exposure.js`** → `GET /api/exposure`
- Calls `computeExposure()` with live Alpaca positions + open trades.
- Returns exposure object from Phase 5.

**`src/server/routes/expectancy.js`** → `GET /api/expectancy`
- Like `/performance` but returns only the expectancy-focused subset: `{ expectancy, profitFactor, winRate, totalTrades, avgWinR, avgLossR }`.
- Useful for a lightweight card component.

**`src/server/routes/candidates.js`** → `GET /api/candidates`
- Query param: `?cycleId=<id>` (defaults to latest cycle).
- Reads decisions for that cycle where `approved: true`, sorted by `setupScore` desc.
- Returns ranked list with `symbol`, `setupScore`, `setupGrade`, `riskReward`, `context`.

**`src/server/routes/rejections.js`** → `GET /api/rejections`
- Query param: `?days=7` (default 7).
- Reads decisions where `approved: false`, grouped by `rejectionClass` and `reason`.
- Returns `{ byClass: { no_signal: N, weak_conditions: N, sizing_error: N }, byReason: {...}, bySymbol: {...} }`.

**`src/server/index.js`**
- Import and register all five new route files.

---

## Phase 7 — Journal Persistence Enrichment

**Goal:** Persist `setupScore`, `rMultiple`, and `duration` on closed trades, plus lifecycle events for the exit engine.

### What to change

**`src/models/ClosedTrade.js`**
- Add fields: `setupScore: Number`, `setupGrade: String`, `rMultiple: Number`, `durationMinutes: Number`, `exitReason` (already exists — ensure exit engine reasons map here), `session: String`.

**`src/journal/closedTradesStore.js`**
- When closing a trade, compute:
  - `rMultiple = (exitPrice - entryPrice) / (entryPrice - stopLoss)` (handles direction).
  - `durationMinutes = (new Date(closedAt) - new Date(openedAt)) / 60000`.
  - Copy `setupScore` and `setupGrade` from the linked `Decision` document (join by `decisionId`).
  - `session` from `resolveSession()` at close time.

**`src/journal/normalizeTrade.js`**
- Pass `setupScore`, `setupGrade` through from the decision payload at open time so they are available at close.

**`src/models/OpenTrade.js`**
- Add `setupScore: Number`, `setupGrade: String` (populated at open so closedTradesStore can copy them without a DB join).

**`src/repositories/tradeJournalRepo.mongo.js`**
- Add compound index `{ closedAt: -1, setupGrade: 1 }` to support analytics queries.

---

## Phase 8 — Frontend Dashboard

**Goal:** Operator-focused dashboard with performance cards, candidate ranking, and risk exposure. New layout replaces/augments the existing `DashboardPage.jsx`.

### New service + hooks

**`client/src/services/analytics.js`**
- `getPerformance(days)` → `GET /api/performance`
- `getExposure()` → `GET /api/exposure`
- `getExpectancy(days)` → `GET /api/expectancy`
- `getCandidates(cycleId)` → `GET /api/candidates`
- `getRejections(days)` → `GET /api/rejections`

**`client/src/hooks/queries/useAnalytics.js`**
- `usePerformance(days)` — 60s stale time (changes slowly).
- `useExposure()` — 15s stale time (live positions).
- `useCandidates(cycleId)` — 30s stale time.
- `useRejections(days)` — 60s stale time.

### New components

**`client/src/components/PerformanceCards.jsx`**
- Four stat cards: Expectancy (R), Profit Factor, Win Rate %, Total Trades.
- Source: `usePerformance`.
- Color code: green if expectancy > 0, red if negative.

**`client/src/components/CandidateRankingTable.jsx`**
- Table columns: Rank, Symbol, Grade (badge), Score, R:R, Session, Entry Price.
- Source: `useCandidates`.
- Empty state: "No candidates this cycle."

**`client/src/components/RiskExposurePanel.jsx`**
- Shows: Total Open Risk % of equity, Open Position Count, Daily P&L vs limit, Unrealized P&L.
- Source: `useExposure`.
- Progress bar for daily loss vs limit (turns red at > 50% of limit).

**`client/src/components/RejectionBreakdown.jsx`**
- Bar chart or simple count table: rejections grouped by `rejectionClass` for last 7 days.
- Source: `useRejections`.

### Updated pages

**`client/src/pages/DashboardPage.jsx`**
- Add a new "Performance" section at the top using `PerformanceCards`.
- Add a "Candidates" section using `CandidateRankingTable`.
- Add a "Risk Exposure" section using `RiskExposurePanel`.
- Existing `SummaryCards`, `OpenPositionsTable`, `RecentDecisionsTable` remain — place below.
- `RejectionBreakdown` added to the existing sidebar/bottom section.

---

## Implementation Order Summary

| Phase | Deliverable | Key Files Changed / Created |
|-------|-------------|----------------------------|
| 1 | Strategy scoring | `breakoutStrategy.js`, `Decision.js`, `decisionRepo.mongo.js` |
| 2 | Candidate ranking | `autopilot.js`, `cycleStages.js` |
| 3 | Portfolio risk engine | `src/risk/portfolioRisk.js` (new), `autopilot.js`, `RiskState.js` |
| 4 | Exit engine | `src/positions/exitEngine.js` (new), `OpenTrade.js`, `positionMonitor.js` |
| 5 | Analytics layer | `src/analytics/performance.js` (new), `src/analytics/exposure.js` (new), `src/repositories/analyticsRepo.mongo.js` (new) |
| 6 | API routes | 5 new route files, `src/server/index.js` |
| 7 | Journal enrichment | `ClosedTrade.js`, `OpenTrade.js`, `closedTradesStore.js`, `normalizeTrade.js` |
| 8 | Frontend | 4 new components, `analytics.js` service, `useAnalytics.js` hooks, `DashboardPage.jsx` |

---

## New Environment Variables

```env
# Candidate ranking
MAX_CANDIDATES_PER_CYCLE=3

# Portfolio risk
MAX_TOTAL_RISK_PCT=5
MAX_CORRELATED_POSITIONS=3
DRAWDOWN_THROTTLE_PCT=1

# Exit engine
MAX_HOLD_BARS=48
TRAILING_ATR_MULTIPLIER=1.5
```

---

## Schema Migration Notes

- `Decision` gets `setupScore`, `setupGrade`, `rejectionClass`, `context` — additive, backward compatible (`strict: false` already set).
- `OpenTrade` gets `setupScore`, `setupGrade`, `breakevenTriggered`, `trailingStopPrice`, `barsHeld`, `maxHoldBars` — additive.
- `ClosedTrade` gets `setupScore`, `setupGrade`, `rMultiple`, `durationMinutes`, `session` — additive.
- `RiskState` gets `totalOpenRisk`, `drawdownThrottleActive` — additive.
- No migrations needed. Mongoose `strict: false` handles old documents gracefully.

---

## Success Metrics (from spec)

| Metric | How it's verified |
|--------|------------------|
| Positive expectancy | `GET /api/expectancy` → `expectancy > 0` over 30-day window |
| Controlled drawdown | `GET /api/exposure` → `dailyLossPct < DAILY_LOSS_LIMIT_PCT` |
| Fewer, higher-quality trades | Cycle logs show reduced `placed` count vs `scanned`; avg `setupGrade` trends toward A/B |
| Clear performance attribution | `GET /api/performance` → `bySymbol` and `byGrade` breakdowns populated |
