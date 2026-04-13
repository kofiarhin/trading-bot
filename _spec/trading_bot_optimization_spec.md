# Trading Bot Full Optimization Spec

## Objective
Build a selective, risk-first, expectancy-driven trading system that compounds capital over time.

---

## Core Shift
From:
scan → approve/reject → place trades

To:
scan → score → rank → apply risk → execute best trades → manage exits → measure → adapt

---

## Key Optimization Layers

### 1. Candidate Ranking
- Score approved trades
- Rank by quality
- Execute only top setups

### 2. Portfolio Risk Engine
- Max total open risk
- Correlation buckets
- Drawdown throttling
- Daily trade limits

### 3. Exit Engine
- Stop loss / take profit
- Breakeven logic
- Time-based exits
- Trailing stops

### 4. Analytics Layer
- Expectancy
- Profit factor
- Win rate
- Performance by symbol/session

### 5. Dashboard
- Performance snapshot
- Open risk exposure
- Ranked candidates
- Rejection analysis

---

## Backend Changes

### Autopilot
- Add candidate pool
- Rank before execution
- Apply portfolio risk

### Strategy
- Add score + setupGrade
- Add rejectionClass
- Add context (session, volatility, trend)

### Risk Engine
- Portfolio-level checks
- Correlation limits

### Journal
- Persist setupScore, R multiples, duration
- Add lifecycle events

### Exit Engine
- Add breakeven, trailing, time exits

---

## API Additions
- /performance
- /exposure
- /expectancy
- /candidates
- /rejections

---

## Frontend Changes
- Operator dashboard layout
- Performance cards
- Candidate ranking table
- Risk exposure panel

---

## Success Metrics
- Positive expectancy
- Controlled drawdown
- Fewer but higher-quality trades
- Clear performance attribution

---

## Final Goal
A system that:
- Selects the best trades
- Protects capital
- Learns from results
- Compounds consistently
