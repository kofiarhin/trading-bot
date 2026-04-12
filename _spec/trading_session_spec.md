# Trading Bot Session & Asset Eligibility Spec

## Objective

Implement a market-session model with:

-   Crypto: 24/7
-   US stocks: only when New York is open
-   Overlap: one cycle only, stocks allowed
-   London-only: crypto only
-   Tokyo-only: crypto only

------------------------------------------------------------------------

## Session States

-   TOKYO
-   LONDON
-   NEW_YORK
-   LONDON_NEW_YORK_OVERLAP
-   CRYPTO_ONLY

------------------------------------------------------------------------

## Rules

### Crypto

-   Always tradable (all sessions)

### US Stocks

-   Only tradable when New York is open

------------------------------------------------------------------------

## Behavior by Session

  Session       Run Bot   Crypto   Stocks
  ------------- --------- -------- --------
  Tokyo         Yes       Yes      No
  London        Yes       Yes      No
  New York      Yes       Yes      Yes
  Overlap       Yes       Yes      Yes
  Crypto Only   Yes       Yes      No

------------------------------------------------------------------------

## Implementation Areas

### 1. time.js

-   Add session resolver
-   Detect Tokyo, London, NY, overlap

### 2. worker15m.js

-   Run if session != CLOSED
-   One cycle per interval

### 3. autopilot.js

-   Remove overlap-only logic
-   Use session resolver

### 4. marketHours.js

-   Crypto always allowed
-   Stocks only when NY open

------------------------------------------------------------------------

## Overlap Rule

-   Only ONE execution
-   No duplicate trades
-   Session labeled as overlap

------------------------------------------------------------------------

## Testing

-   Tokyo → crypto only
-   London → crypto only
-   NY → crypto + stocks
-   Overlap → single run
-   Weekend → crypto only

------------------------------------------------------------------------

## Final Model

-   Scheduler always runs
-   Session determines permissions
-   No duplicate executions
