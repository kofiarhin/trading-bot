# Codex Prompt — Final Runtime Hardening Pass

You are working inside an existing full-stack trading bot codebase.

Your task is to perform the **final hardening + cleanup pass** for the event-driven runtime cycle system.  
Do **not** redesign the app from scratch. Read the current codebase first, identify what is already implemented, and complete the remaining work in place.

The runtime/dashboard architecture already exists in the codebase. Your job is to finish it cleanly, safely, and without regressions.

---

## Project context

Production behavior should be:

- Heroku Scheduler triggers the app every **10 minutes**
- Scheduler calls `POST /api/cycle/run`
- The bot starts immediately
- It runs the full trading cycle as fast as needed
- It updates runtime state while running
- The dashboard reflects the running cycle in real time
- When the cycle ends, the UI shows completion and then settles into waiting for the next trigger

This is **not** a fixed 15-minute countdown loop.  
The UI must be driven by **real runtime state**, not guessed timers.

---

## Current state of the codebase

A large part of the runtime system is already implemented.

Backend pieces already exist in some form:
- `src/models/CycleRuntime.js`
- `src/repositories/cycleRuntimeRepo.mongo.js`
- `src/autopilot/cycleStages.js`
- `src/autopilot.js`
- `src/server/routes/cycle.js`
- `src/server/routes/dashboard.js`

Frontend pieces already exist in some form:
- `client/src/services/cycle.js`
- `client/src/hooks/queries/useCycleRuntime.js`
- `client/src/components/CycleProgressBar.jsx`
- `client/src/pages/DashboardPage.jsx`
- `client/src/components/LastCyclePanel.jsx`
- `client/src/components/ActivityFeed.jsx`

Do **not** replace these blindly. Extend and finalize them.

---

## Primary goal

Finish the runtime system so it is production-safe, consistent, and polished.

---

## Main remaining issues to fix

### 1. Lower stale runtime timeout default
File:
- `src/repositories/cycleRuntimeRepo.mongo.js`

Current behavior:
- default stale timeout is too long for a 10-minute scheduler cadence

Required change:
- reduce the default stale timeout from the current high value to **5 minutes**  
- keep env override support via something like `CYCLE_RUNTIME_STALE_MINUTES`

Reason:
- if the process crashes, the dashboard should not remain falsely stuck on `running` for too long

---

### 2. Normalize dashboard status vocabulary
Files:
- `src/server/routes/dashboard.js`
- any shared status helper used by dashboard responses

Problem:
- runtime-driven statuses may still be mixed with older inferred labels like:
  - `active`
  - `idle`
  - `running`

Required change:
- standardize the status contract everywhere the dashboard depends on it

Use only:
- `running`
- `waiting`
- `completed`
- `failed`
- `idle`

Requirements:
- runtime is the primary source of truth
- older inferred cycle logic may remain only as fallback when runtime is missing
- do not return mixed status vocabularies in different payload shapes

---

### 3. Confirm / fix runtime polling interval
File:
- `client/src/hooks/queries/useCycleRuntime.js`

Required behavior:
- when `runtime.status === "running"`, poll every **2000ms**
- otherwise poll every **10000ms**
- preserve previous data while refetching

If the file already does this, keep it.
If not, update it.

---

### 4. Ensure all major cycle stages emit activity events
Files:
- `src/autopilot.js`
- `src/server/routes/dashboard.js`

Problem:
- runtime may be updating correctly, but the activity feed can still feel patchy if all major stages are not emitted as events

Make sure the cycle emits stage-level events for all major stages:
- `starting`
- `syncing_broker`
- `monitoring_positions`
- `fetching_market_data`
- `evaluating_signals`
- `applying_risk_guards`
- `placing_orders`
- `final_sync`
- `completed`
- `failed`

Requirements:
- use the existing event logging/append mechanism if one already exists
- do not invent a second event system
- ensure dashboard activity mapping surfaces these clearly to the frontend
- do not break existing trade event rendering

---

### 5. Tighten runtime-driven dashboard header behavior
File:
- `client/src/pages/DashboardPage.jsx`

The header is already runtime-driven, but make sure its status wording is explicit and consistent.

Expected labels:
- Running: `Cycle running — <stage label>`
- Completed: `Cycle complete`
- Waiting: `Waiting for next trigger`
- Failed: `Cycle failed`
- Idle: `Idle`

Requirements:
- use runtime state as the primary source of truth
- avoid falling back to stale active/idle semantics in the header
- keep the UI clean and minimal

---

### 6. Improve progress bar polish without changing the architecture
File:
- `client/src/components/CycleProgressBar.jsx`

Current state:
- progress bar exists and works

Required improvement:
- replace or improve any overly basic pulse-only effect with a more subtle “live system” feel
- use a moving shimmer/gradient effect if practical
- keep the component slim and understated
- do not make it look like a countdown timer
- preserve current behavior:
  - show while running
  - use backend `progressPct`
  - align with existing dashboard theme

This is a polish pass, not a redesign.

---

### 7. Verify / improve LastCyclePanel live mode
File:
- `client/src/components/LastCyclePanel.jsx`

Requirements:
- when runtime is running, show current cycle info:
  - startedAt
  - stage
  - symbolCount
  - scanned
  - approved
  - rejected
  - placed
- when no cycle is running, show the latest completed cycle
- preserve current design style

Optional polish:
- if the duration while running only updates on polling refresh, that is acceptable unless a tiny local timer can be added without complexity

---

### 8. Verify stale-run recovery is wired end-to-end
Files:
- `src/repositories/cycleRuntimeRepo.mongo.js`
- `src/server/routes/cycle.js`
- any startup/bootstrap or runtime-read path if relevant

Requirements:
- stale running cycles must be detected using `heartbeatAt`
- recovery should mark them into a clear non-running state, ideally `failed`
- both the runtime route and dashboard route should surface the recovered state correctly
- the dashboard must not remain stuck on a false running state forever

---

### 9. Add / update backend tests for critical runtime behavior
Files:
- existing backend test folders/files, or add new focused test files if needed

Required backend test coverage:
- unauthorized `POST /api/cycle/run` returns `401`
- overlapping run returns `409`
- stale running runtime gets recovered
- successful cycle ends in `completed`
- thrown cycle error ends in `failed`

Guidelines:
- update existing tests if similar files already exist
- add focused backend tests only where missing
- do not create a huge unnecessary test scaffold

---

## Constraints

- Keep the current architecture
- Do not create parallel runtime systems
- Do not break existing decision engine, execution engine, trade journaling, or dashboard data flow
- Use existing repo conventions
- Do not hard-code secrets
- Use env/config patterns already present in the codebase
- Keep changes focused and production-safe
- Avoid TODO placeholders
- Prefer finishing what exists over rewriting what already works

---

## Output requirements

Make the changes directly in the codebase.

Then provide:

1. A concise summary of what changed
2. A changed-files list
3. Any env vars added or updated
4. Any Heroku Scheduler / deployment notes
5. Any tests added or updated

---

## Definition of done

This task is complete only when:

- stale runtime timeout default matches the real scheduler model
- dashboard status vocabulary is fully normalized
- runtime polling is responsive while running
- all major cycle stages appear in the activity feed
- dashboard header is cleanly runtime-driven
- progress bar is polished but still subtle
- stale-run recovery works end-to-end
- backend tests cover auth, overlap, stale recovery, success, and failure transitions
- no major existing behavior regresses
