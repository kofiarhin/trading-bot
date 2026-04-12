# Claude Code Prompt — Final Consistency Cleanup After 20-Crypto Expansion

Use this prompt in Claude Code against the current repo.

---

## Prompt

You are working inside my current trading bot repo.

The 20-asset crypto-universe expansion and `MAX_OPEN_POSITIONS=5` implementation are already in place and should remain intact.

### Current intended runtime behavior
- Crypto universe contains 20 approved pairs
- `MAX_OPEN_POSITIONS=5`
- Crypto trades 24/7
- US stocks trade only when New York is open
- London-only = crypto only
- Tokyo-only = crypto only
- London/New York overlap = one cycle only, with stocks allowed

### What is still wrong
The remaining issues are **consistency/documentation/CLI support**, not the main runtime logic.

Specifically:
- `src/symbols.js` still reflects the older smaller crypto set
- the user-facing supported-symbol message is stale
- `README.md` still contains outdated values like `MAX_OPEN_POSITIONS=3` and references to the older smaller crypto setup

Your job is to do a **targeted cleanup** so the repo is consistent with the implemented 20-crypto expansion.

Do not redesign the system. Do not refactor unrelated code. Keep the runtime behavior intact.

---

## Constraints

- Make minimal, targeted edits
- Do not change the working session logic
- Do not change the strategy logic
- Do not change stock eligibility behavior
- Do not introduce unrelated refactors
- Keep comments/docs accurate and concise
- Update tests only if needed for the stale symbol-support layer

---

## What to fix

### 1. Expand CLI / symbol-resolution support

Audit `src/symbols.js` and update it so the supported crypto aliases / symbol resolution match the current 20-asset crypto universe.

The supported crypto set should include:

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

#### Requirements
- ensure CLI parsing / normalization supports the expanded set
- ensure no duplicate aliases
- keep existing behavior for stocks intact
- keep output formatting consistent with the rest of the repo

---

### 2. Update user-facing supported-symbol messaging

Any user-facing supported-symbol/help text that still lists the old smaller crypto set must be updated.

This includes the message currently describing supported crypto symbols.

#### Expected result
The supported-symbol/help message should accurately reflect the expanded crypto universe and no longer imply only 3 or 4 crypto symbols are supported.

---

### 3. Update stale repo documentation

Audit `README.md` for stale values and text related to the old smaller crypto setup.

At minimum fix:
- `MAX_OPEN_POSITIONS=3` -> `MAX_OPEN_POSITIONS=5`
- any examples or config snippets that imply the old small crypto universe
- any wording that conflicts with the current runtime/session model

Do not rewrite the entire README. Only correct stale sections so docs match the implemented behavior.

---

### 4. Optional test cleanup only if needed

If there are tests tied to old symbol-resolution assumptions, update them minimally.

Only touch tests if the stale `src/symbols.js` behavior was already covered or if the change could break existing symbol normalization.

Do not add broad new tests unless necessary.

---

## Files to inspect first

Start with:
- `src/symbols.js`
- `README.md`

Then check for any nearby help text or symbol-support messages those files feed into.

---

## Deliverables

Apply the edits directly in the repo.

When done, return:
1. **Changed files**
2. **What was fixed**
3. **Any assumptions**
4. **Any follow-up cleanup still worth doing**

Do not stop at analysis. Make the changes.

---

## Acceptance criteria

The work is complete only if all of the following are true:

- `src/symbols.js` supports the full 20-asset crypto universe
- user-facing supported-symbol/help text is updated to the 20-asset crypto set
- `README.md` no longer says `MAX_OPEN_POSITIONS=3`
- docs/help text no longer imply the old smaller crypto setup
- runtime session logic remains unchanged
- no unrelated refactors are introduced
