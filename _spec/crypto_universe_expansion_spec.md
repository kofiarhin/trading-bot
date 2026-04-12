# Crypto Universe Expansion Spec

## Objective

Expand the trading bot's crypto universe from 3 assets to 20 assets
while maintaining: - Session-based execution logic - Controlled risk via
position limits - Stable system performance

------------------------------------------------------------------------

## Final Configuration

### Crypto Universe (20 Assets)

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

### Risk Control

    MAX_OPEN_POSITIONS=5

------------------------------------------------------------------------

## Expected Behavior by Session

### Tokyo Session

-   Bot runs
-   Crypto scanned: 20 symbols
-   Stocks: Not allowed

### London Session

-   Bot runs
-   Crypto scanned: 20 symbols
-   Stocks: Not allowed

### New York Session

-   Bot runs
-   Crypto scanned: 20 symbols
-   Stocks: Allowed

### London/New York Overlap

-   Single execution cycle
-   Crypto scanned: 20 symbols
-   Stocks: Allowed

### Off-session / Weekend

-   Bot runs
-   Crypto scanned: 20 symbols
-   Stocks: Not allowed

------------------------------------------------------------------------

## Impact Analysis

### 1. Increased Opportunity

-   More setups per cycle
-   Higher probability of valid signals

### 2. Increased Signal Frequency

-   Expected increase in approvals per day

### 3. Position Cap Interaction

-   MAX_OPEN_POSITIONS=5 prevents overexposure

### 4. Correlation Risk

-   Multiple crypto assets may move together
-   Possible clustering of trades

### 5. Performance

-   Slight increase in API usage
-   Still within safe limits

------------------------------------------------------------------------

## What Does NOT Change

-   Session logic remains intact
-   Scheduler timing unchanged
-   Overlap still executes once per cycle
-   Stock eligibility rules unchanged

------------------------------------------------------------------------

## Monitoring Plan

Track after rollout:

1.  Symbols scanned per cycle
    -   Expected: 20 (crypto-only sessions)
    -   Expected: 20 + stocks (NY session)
2.  Approved signals per day
    -   Should increase moderately
3.  Open positions
    -   Should cap at 5
4.  Trade clustering
    -   Watch for correlated entries

------------------------------------------------------------------------

## Rollout Strategy

### Phase 1

-   Deploy updated crypto universe
-   Set MAX_OPEN_POSITIONS=5

### Phase 2

-   Monitor for 1--3 days
-   Validate behavior across sessions

### Phase 3

-   Evaluate signal quality and performance

------------------------------------------------------------------------

## Key Insight

This change increases opportunity without changing system logic.

The bot becomes more active while maintaining: - Controlled risk -
Session awareness - Stable execution

------------------------------------------------------------------------

## Future Improvements

-   Signal ranking system
-   Correlation filtering
-   Volume-based filtering
-   Dynamic position sizing

------------------------------------------------------------------------

## Summary

The system remains stable while expanding its ability to detect and act
on trading opportunities across all sessions.
