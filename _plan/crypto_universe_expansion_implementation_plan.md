# Crypto Universe Expansion Implementation Plan

## Objective

Implement the approved crypto-universe expansion so the bot moves from a small crypto scan set to a broader 20-asset crypto universe while preserving:

- current session-execution behavior
- crypto 24/7 support
- US stocks only during New York-open windows
- single-cycle handling during London/New York overlap
- controlled exposure with `MAX_OPEN_POSITIONS=5`

This plan is based on the approved expansion spec and is focused on safe rollout, validation, and observability.

---

## Final Target State

### Crypto universe
Use this 20-asset set:

```js
[
  "BTC/USD",
  "ETH/USD",
  "SOL/USD",
  "BNB/USD",
  "XRP/USD",
  "AVAX/USD",
  "ADA/USD",
  "LINK/USD",
  "MATIC/USD",
  "DOT/USD",
  "LTC/USD",
  "DOGE/USD",
  "BCH/USD",
  "UNI/USD",
  "ATOM/USD",
  "NEAR/USD",
  "AAVE/USD",
  "ETC/USD",
  "FIL/USD",
  "ALGO/USD"
]
```

### Risk / capacity
```env
MAX_OPEN_POSITIONS=5
```

---

## Implementation Goals

1. Expand the configured crypto universe from the current reduced set to the approved 20 symbols.
2. Keep current session logic unchanged.
3. Ensure Tokyo, London, weekend, and off-session windows still remain crypto-only.
4. Ensure New York and London/New York overlap continue to allow US stocks in addition to crypto.
5. Keep overlap behavior to a single cycle only.
6. Avoid changing strategy behavior, execution model, or timing model unless required by the spec.
7. Preserve current dashboard/reporting clarity so scan counts reflect the larger universe.

---

## Scope of Change

### In scope
- crypto universe configuration
- max-open-position configuration
- validation of session-dependent scan behavior
- log/dashboard confirmation after rollout
- tests or checks if the repo already has a clean place for them

### Out of scope
- strategy redesign
- signal-ranking changes
- portfolio-correlation logic
- new risk engine logic
- ATR/volume filter redesign
- stop-loss/take-profit redesign
- stock universe changes

---

## Expected Behavior After Implementation

### Tokyo session
- bot runs
- scans 20 crypto symbols
- scans no US stocks

### London session
- bot runs
- scans 20 crypto symbols
- scans no US stocks

### New York session
- bot runs
- scans 20 crypto symbols plus eligible US stocks

### London/New York overlap
- bot runs once per boundary
- scans 20 crypto symbols plus eligible US stocks
- does not create duplicate cycle execution

### Off-session / weekend
- bot runs
- scans 20 crypto symbols
- scans no US stocks

---

## Repo Audit Before Editing

Before implementation, identify exactly where the current crypto universe and max-position settings are defined.

### Check these likely areas
- universe/config file for symbol definitions
- environment configuration loader
- `.env`
- `.env.example`
- any dashboard summary logic that assumes small crypto scan counts
- any tests hard-coded to the old 3-symbol crypto set

### Confirm before editing
- whether the crypto universe is source-controlled in code
- whether the max-open-position setting comes only from env
- whether any fixtures/tests currently assert old scan counts

---

## Phase 1 — Update the Crypto Universe

### Goal
Replace the current smaller crypto asset list with the approved 20-symbol list.

### Tasks
1. Locate the canonical crypto universe definition.
2. Replace the current list with the 20 approved pairs.
3. Verify symbol formatting matches the broker/data-provider format already used in the repo.
4. Keep stock universe unchanged.
5. Check for duplicate symbols or unsupported pair naming.

### Acceptance criteria
- the runtime can enumerate all 20 crypto symbols
- no malformed symbol names
- no unintended changes to stock symbols

---

## Phase 2 — Update Position Capacity

### Goal
Set the maximum open positions to 5.

### Tasks
1. Update the runtime configuration value for `MAX_OPEN_POSITIONS`.
2. Update `.env.example` if needed.
3. Confirm the config loader reads the new value correctly.
4. Verify there are no conflicting defaults in code.

### Acceptance criteria
- the bot caps at 5 concurrent open positions
- no hidden code default overrides the env value
- config remains consistent across local and production environments

---

## Phase 3 — Validate Session Behavior Remains Intact

### Goal
Ensure the universe expansion does not alter session logic.

### Tasks
Verify these outcomes:

#### Crypto-only windows
- Tokyo session -> 20 crypto symbols, 0 US stocks
- London session -> 20 crypto symbols, 0 US stocks
- weekend/off-session -> 20 crypto symbols, 0 US stocks

#### Mixed windows
- New York session -> 20 crypto symbols + stocks
- London/New York overlap -> 20 crypto symbols + stocks

#### Overlap protection
- overlap still runs one cycle only
- no double scheduling
- no duplicate order attempts caused by overlap

### Acceptance criteria
- symbol eligibility remains session-correct
- overlap behavior remains single-cycle
- no regression in stock eligibility rules

---

## Phase 4 — Audit Tests and Update Where Needed

### Goal
Prevent regressions from the larger crypto universe.

### Tasks
1. Identify tests that rely on old crypto-universe size.
2. Update fixtures or expectations if they were built around 3 crypto symbols.
3. Keep existing session and eligibility tests intact unless the new universe size changes assertions.
4. Add a focused test only if needed to prove the expanded list is actually loaded/filtered correctly.

### Recommended minimum validation
- crypto-only sessions still filter to crypto only
- New York sessions still include stocks
- overlap still behaves as one cycle
- the full crypto list is accepted without parsing/format errors

### Acceptance criteria
- tests pass after universe expansion
- no stale test assumptions about a 3-symbol crypto set

---

## Phase 5 — Pre-Deployment Validation

### Goal
Confirm the change is safe before production rollout.

### Checklist
- config loads successfully
- no invalid symbol names
- bot starts cleanly
- cycle completes successfully
- dashboard still loads
- scan count rises as expected
- open-position cap still enforced at 5
- no unexpected errors from market-data fetch layer

### Recommended local/staging checks
1. Run one manual cycle.
2. Confirm the cycle summary shows more crypto symbols scanned.
3. Confirm no stock scans appear in Tokyo/London/off-session windows.
4. Confirm New York scan count includes crypto + stocks.

---

## Phase 6 — Controlled Production Rollout

### Goal
Deploy safely and verify live behavior.

### Rollout steps
1. Deploy the updated crypto universe and `MAX_OPEN_POSITIONS=5`.
2. Keep all other trading/risk settings unchanged.
3. Observe the bot across multiple session windows.

### Observe specifically
#### Tokyo-only window
Expected:
- crypto-only scan
- roughly 20 crypto symbols scanned

#### London-only window
Expected:
- crypto-only scan
- roughly 20 crypto symbols scanned

#### New York window
Expected:
- crypto + stock scan
- total scan count meaningfully higher than 20

#### Overlap window
Expected:
- crypto + stocks
- only one cycle per boundary
- no duplicate cycle logs

### Rollback trigger examples
Rollback or pause if:
- symbols fail to fetch consistently
- cycle durations spike unexpectedly
- duplicate trades appear
- the bot opens positions too aggressively relative to prior behavior
- unsupported symbols create repeated data/execution errors

---

## Phase 7 — Post-Deployment Monitoring

### Goal
Judge whether the expansion improved opportunity without degrading quality.

### Metrics to monitor
1. **Symbols scanned per cycle**
   - crypto-only windows: about 20
   - New York windows: 20 + stock count

2. **Approved signals per day**
   - should increase moderately, not explode

3. **Orders placed per day**
   - should rise somewhat if strategy quality holds

4. **Open positions**
   - should cap at 5

5. **Trade clustering**
   - watch for many correlated crypto entries at once

6. **Cycle duration**
   - should remain operationally healthy despite the larger universe

7. **Error rate**
   - watch market-data lookup failures, unsupported pairs, or execution rejections

---

## Risk Notes

### 1. Correlation risk
Expanding to 20 crypto assets increases the chance that multiple approved trades are really the same market exposure.

Example:
- BTC, ETH, SOL, AVAX, and LINK may break out around the same time

This is acceptable for this rollout because `MAX_OPEN_POSITIONS=5` limits exposure, but it should still be monitored.

### 2. Strategy noise
A larger universe means more opportunities, but also more potential low-quality setups.

Do not change strategy thresholds at the same time as the universe expansion. Keep the rollout isolated so performance changes are easier to interpret.

### 3. API/data load
20 crypto symbols on a 15-minute cycle should still be operationally light, but verify cycle duration and data-fetch stability after deployment.

---

## What Must Not Change During This Implementation

Do not change:
- session resolver logic
- New York-only stock eligibility logic
- overlap handling logic
- scheduler cadence
- stock universe
- risk percentage
- stop-loss / target logic
- decision engine thresholds

This rollout should isolate only:
- crypto universe expansion
- max position cap update

---

## Definition of Done

The implementation is complete when all of the following are true:

- the crypto universe contains the approved 20 pairs
- `MAX_OPEN_POSITIONS=5` is active
- Tokyo/London/off-session windows remain crypto-only
- New York and overlap windows allow crypto + US stocks
- overlap still executes only one cycle
- no unsupported symbol errors are introduced
- dashboard/logs show increased crypto scan counts as expected
- tests and fixtures are updated if they depended on the old smaller crypto universe

---

## Recommended Follow-Up After Stabilization

After 2–5 days of clean paper/live observation, evaluate whether to add:

- signal ranking
- correlation controls
- per-symbol or per-sector caps
- volume/liquidity filters
- ATR-based ranking
- better portfolio-level risk controls

These should come **after** the universe expansion is confirmed stable.

---

## Summary

This implementation should increase opportunity across all bot runtime windows without changing the session model.

### Net effect
- Tokyo/London/off-session windows become more active because crypto scan breadth increases from a very small set to 20 assets
- New York windows become more opportunity-rich because crypto breadth increases while stock eligibility stays intact
- risk remains controlled through `MAX_OPEN_POSITIONS=5`
- overlap behavior remains unchanged: one cycle only

The implementation should be rolled out as a focused, isolated configuration/universe change with validation before and after deployment.
