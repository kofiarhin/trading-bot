# Claude Code Prompt — Fix Remaining Session-Execution Gaps

Use this prompt in Claude Code against the current repo.

---

## Prompt

You are working inside my current trading bot repo.

Your job is to **finish and clean up the session-execution implementation** so the codebase fully matches this behavior:

- **Crypto trades 24/7**
- **US stocks trade only when New York is open**
- **London/New York overlap runs only one cycle**
- **London-only = crypto only**
- **Tokyo-only = crypto only**

Do **not** redesign the architecture. Keep the current direction and patch the remaining gaps cleanly.

### Constraints

- Do not introduce unnecessary refactors.
- Keep existing structure unless a small targeted cleanup is required.
- Prefer minimal, production-safe edits.
- Update tests as part of the work.
- If any behavior changes, update related status strings/comments so the UI and logs stay accurate.
- Do not hard-code secrets.
- Keep package layout as-is.

---

## What to fix

### 1. Remove stale overlap-era wording from repo/UI/history layers

Audit and update any remaining legacy wording or event semantics that still assume the old behavior was “NYSE/LSE overlap only”.

Examples of stale wording to remove or replace:
- `skipped_outside_overlap`
- `outside NYSE/LSE overlap`
- comments that describe the old overlap-only scheduler
- stale `.env.example` comments referring to “skip the NYSE/LSE overlap window check”

Replace them with wording that matches the new session model.

#### Expected result
Use session-aware / neutral language such as:
- `outside configured sessions`
- `session execution`
- `crypto-only window`
- `New York session`
- `London/New York overlap`

Also update `.env.example` comment text so it no longer references the old overlap-only behavior.

---

### 2. Standardize cycle/status metadata around the new session model

Where cycle events or dashboard payloads are built, make sure they consistently expose session-aware metadata.

Ensure terminal cycle records and/or latest-cycle payloads include or preserve:
- `session`
- `allowCrypto`
- `allowStocks`
- scanned counts
- approved counts
- placed counts
- reason when skipped or failed

Do not break existing dashboard behavior, but make sure the reporting layer matches runtime reality.

#### Expected result
The dashboard/history should no longer imply the bot only operates during overlap windows.

---

### 3. Add test coverage for the session resolver

Add or update backend tests for the new session logic.

At minimum cover:
- Tokyo-only timestamp
- London-only timestamp
- New York-only timestamp
- London/New York overlap timestamp
- crypto-only/off-session timestamp
- stock eligibility only when New York is open
- crypto eligibility always true

If the repo already has a backend test setup, use it. If not, extend the existing backend test setup minimally.

#### Important
Tests should validate the real exported functions in the current implementation, not a mocked rewrite.

---

### 4. Add a focused integration test for symbol eligibility/filtering

Add one practical test proving the runtime symbol filtering matches the intended behavior.

At minimum verify:
- Tokyo session -> only crypto symbols are eligible/scanned
- London session -> only crypto symbols are eligible/scanned
- New York session -> crypto + stock symbols are eligible/scanned
- overlap -> still one pass with crypto + stocks eligible

Keep this test targeted. Do not over-engineer.

---

### 5. Audit config/docs comments for stale instructions

Search the repo for comments/docs that still describe the old overlap-only model and update them.

This includes:
- `.env.example`
- inline code comments
- small operational docs if they directly conflict with current behavior

Do not rewrite unrelated documentation.

---

## Files to inspect first

Start by auditing these files:

- `src/utils/time.js`
- `src/market/marketHours.js`
- `src/autopilot.js`
- `src/worker15m.js`
- `src/server/routes/dashboard.js`
- `src/repositories/cycleRepo.mongo.js`
- `.env.example`

Then check related tests and any nearby files those modules depend on.

---

## Deliverables

Make the changes directly in the repo.

When done, return:

1. **Changed files**
2. **What was fixed**
3. **Any assumptions**
4. **Any follow-up risks or optional improvements**

Do not stop at analysis. Apply the edits.

---

## Acceptance criteria

The work is complete only if all of the following are true:

- No active runtime/status/config wording still incorrectly describes the system as overlap-only
- `.env.example` comment text is updated to the new session model
- Session resolver has direct test coverage
- Market eligibility has direct test coverage
- At least one integration test proves symbol filtering behavior by session
- Dashboard/history semantics are aligned with the implemented runtime behavior
- No duplicate-cycle behavior is introduced during overlap

