# 🔥 FEATURE SPEC: Decision Insight Layer (Distance to Breakout + Watch Signals)

## 🎯 OBJECTIVE

Enhance the trading dashboard by transforming rejected decisions into actionable insights.

Specifically:
- Add `distanceToBreakoutPct` metric
- Improve decision reasoning
- Introduce “watch zone” highlighting
- Keep full backward compatibility

---

# 🧱 ARCHITECTURE CONTEXT

System flow (already implemented):
- Strategy → Decision → decisionLogger → API → Dashboard

We are extending the **decision object + UI layer**, NOT changing strategy logic.

---

# 🧩 PART 1 — STRATEGY LAYER UPDATE

## File: `server/strategies/breakoutStrategy.js` (or equivalent)

### Add new metric

```js
const distanceToBreakoutPct =
  breakoutLevel > 0
    ? ((breakoutLevel - close) / breakoutLevel) * 100
    : null;
```

---

## Modify return object

### BEFORE

```js
return {
  approved: false,
  reason: `no breakout: close ${close} ≤ highest high ${breakoutLevel}`
};
```

### AFTER

```js
return {
  approved: false,
  reason: "no breakout",
  metrics: {
    close,
    breakoutLevel,
    atr,
    volumeRatio,
    distanceToBreakoutPct
  }
};
```

---

## Improve reason string (optional but recommended)

```js
const reason = distanceToBreakoutPct !== null
  ? `no breakout (${distanceToBreakoutPct.toFixed(2)}% below level)`
  : "no breakout";
```

---

# 🧩 PART 2 — DECISION LOGGER UPDATE

## File: `server/utils/decisionLogger.js` (or equivalent)

### Ensure metrics are persisted

```js
const decisionRecord = {
  symbol,
  asset,
  decision: approved ? "approved" : "rejected",
  reason,
  metrics: metrics || {},
  timestamp: new Date().toISOString()
};
```

---

# 🧩 PART 3 — API LAYER UPDATE

## File: `server/routes/dashboard.js`

### Modify recent decisions response

```js
return {
  symbol: d.symbol,
  asset: d.asset,
  decision: d.decision,
  reason: d.reason,

  close: d.metrics?.close ?? null,
  breakout: d.metrics?.breakoutLevel ?? null,
  atr: d.metrics?.atr ?? null,
  volumeRatio: d.metrics?.volumeRatio ?? null,
  distanceToBreakoutPct: d.metrics?.distanceToBreakoutPct ?? null,

  timestamp: d.timestamp
};
```

---

# 🧩 PART 4 — FRONTEND UPDATE (React + Vite + Tailwind)

## File: `client/src/components/RecentDecisionsTable.jsx`

### Add new column

```jsx
<th>Distance</th>
```

---

### Render value

```jsx
<td>
  {row.distanceToBreakoutPct !== null
    ? `${row.distanceToBreakoutPct.toFixed(2)}%`
    : "—"}
</td>
```

---

### Watch classification helper

```js
const getWatchLevel = (distance) => {
  if (distance === null) return "none";
  if (distance <= 0.25) return "very-close";
  if (distance <= 0.75) return "watch";
  return "far";
};
```

---

### Apply styling

```jsx
<td
  className={`
    ${getWatchLevel(row.distanceToBreakoutPct) === "very-close" ? "text-yellow-300 font-bold" : ""}
    ${getWatchLevel(row.distanceToBreakoutPct) === "watch" ? "text-yellow-500" : ""}
  `}
>
  {row.distanceToBreakoutPct !== null
    ? `${row.distanceToBreakoutPct.toFixed(2)}%`
    : "—"}
</td>
```

---

### Optional badge

```jsx
{getWatchLevel(row.distanceToBreakoutPct) === "very-close" && (
  <span className="ml-2 px-2 py-1 text-xs bg-yellow-400 text-black rounded">
    VERY CLOSE
  </span>
)}

{getWatchLevel(row.distanceToBreakoutPct) === "watch" && (
  <span className="ml-2 px-2 py-1 text-xs bg-yellow-600 text-white rounded">
    WATCH
  </span>
)}
```

---

# 🧩 PART 5 — OPTIONAL UX IMPROVEMENT

```jsx
<td>
  {row.reason}
  {row.distanceToBreakoutPct !== null && (
    <div className="text-xs text-gray-400">
      {row.distanceToBreakoutPct.toFixed(2)}% below breakout
    </div>
  )}
</td>
```

---

# 🧪 TESTING REQUIREMENTS

## Backend
- distance calculated correctly
- null-safe when breakout = 0
- persisted correctly in decision log

## Frontend
- renders distance correctly
- shows "—" when null
- highlights thresholds correctly

---

# ⚠️ EDGE CASES

```js
if (!breakoutLevel || breakoutLevel === 0) return null;
if (!close) return null;
```

---

# 🚫 DO NOT CHANGE

- Strategy conditions
- Approval logic
- Execution engine
- Existing API routes (only extend)

---

# ✅ SUCCESS CRITERIA

Dashboard shows:

BTC/USD — Rejected  
Reason: no breakout  
Distance: 0.63% → WATCH  

---

# 🧠 OUTCOME

Transforms system from:
- passive logger

Into:
- active opportunity scanner
