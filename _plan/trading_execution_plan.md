# Trading Bot Session-Based Execution Plan

## Objective

Implement a session-aware trading system with:

-   Crypto: 24/7
-   US Stocks: Only when New York is open
-   Overlap: Single execution cycle
-   London-only: Crypto only
-   Tokyo-only: Crypto only

------------------------------------------------------------------------

## Current System Issues

### 1. autopilot.js

-   Blocks execution unless NYSE + LSE overlap

### 2. worker15m.js

-   Uses US market hours only

### 3. marketHours.js

-   Stocks tied only to US hours
-   Crypto always allowed

------------------------------------------------------------------------

## Target Behavior

-   Bot runs every 15 minutes
-   Crypto always tradable
-   Stocks only tradable during New York session
-   Overlap does NOT trigger duplicate cycles

------------------------------------------------------------------------

## Core Design

### Separate Decisions

1.  Should bot run?
    -   Yes (every 15 mins)
2.  Which assets are tradable?
    -   Crypto: Always
    -   Stocks: Only when NY open

------------------------------------------------------------------------

## Session Model

States:

-   TOKYO
-   LONDON
-   NEW_YORK
-   LONDON_NEW_YORK_OVERLAP
-   CRYPTO_ONLY

------------------------------------------------------------------------

## File-by-File Implementation

### 1. src/utils/time.js

-   Add Tokyo time conversion
-   Add session resolver
-   Detect overlap
-   Return:
    -   session
    -   allowCrypto
    -   allowStocks

------------------------------------------------------------------------

### 2. src/market/marketHours.js

-   Use session resolver
-   Crypto → always true
-   Stocks → only when NY open

------------------------------------------------------------------------

### 3. src/autopilot.js

-   Remove overlap-only gate
-   Resolve session at start
-   Filter symbols BEFORE fetching data
-   Include session metadata in logs

------------------------------------------------------------------------

### 4. src/worker15m.js

-   Remove stock-hour dependency
-   Run every 15 mins
-   Let autopilot handle eligibility

------------------------------------------------------------------------

### 5. src/server/routes/dashboard.js

-   Replace overlap-only labels
-   Show session status
-   Show asset eligibility

------------------------------------------------------------------------

### 6. cycleRepo + logging

Include: - session - stocksEligible - cryptoEligible - scanned /
approved / placed

------------------------------------------------------------------------

## Overlap Rule

-   Only ONE cycle per 15-minute boundary
-   No duplicate execution
-   Label as: LONDON_NEW_YORK_OVERLAP

------------------------------------------------------------------------

## Testing Plan

### Session Tests

-   Tokyo only
-   London only
-   NY only
-   Overlap
-   Weekend

### Eligibility Tests

-   Crypto always true
-   Stocks only when NY open

### Integration Tests

-   Tokyo → crypto only
-   London → crypto only
-   NY → crypto + stocks
-   Overlap → single execution

------------------------------------------------------------------------

## Final Behavior

  Session       Crypto   Stocks
  ------------- -------- --------
  Tokyo         Yes      No
  London        Yes      No
  New York      Yes      Yes
  Overlap       Yes      Yes
  Crypto Only   Yes      No

------------------------------------------------------------------------

## Execution Flow

1.  Worker triggers every 15 minutes
2.  Autopilot resolves session
3.  MarketHours filters assets
4.  Strategy runs on eligible symbols
5.  Results logged with session metadata

------------------------------------------------------------------------

## Key Principles

-   Single source of truth: time.js
-   No duplicate runs during overlap
-   Crypto always available
-   Stocks follow actual exchange hours
