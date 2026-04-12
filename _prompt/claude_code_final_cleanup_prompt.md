# Claude Code Prompt — Final Cleanup for Legacy Overlap Event Semantics

Use this prompt in Claude Code against the current repo.

---

## Prompt

You are working inside my current trading bot repo.

The main session-execution refactor is already implemented and mostly working.

### Current intended behavior
- **Crypto trades 24/7**
- **US stocks trade only when New York is open**
- **London-only = crypto only**
- **Tokyo-only = crypto only**
- **London/New York overlap = one cycle only, with stocks allowed because New York is open**

### What is still wrong
The repo still contains **legacy overlap-era cycle event semantics** in active code paths, especially around:
- `skipped_outside_overlap`
- old terminal cycle type compatibility logic
- dashboard/repository paths that still actively treat overlap-era skip events as part of the current model

Your job is to do the **final cleanup pass** so the current runtime/reporting model is clean, consistent, and aligned with the new session behavior.

Do not redesign the app. Patch only what is still stale.

---

## Constraints

- Keep the existing architecture.
- Make minimal, targeted edits.
- Preserve backward compatibility with old persisted data **only if truly needed**, but do not let legacy event types remain part of the active/current event model.
- Prefer migration-safe handling over broad refactors.
- Keep tests updated.
- Do not hard-code secrets.
- Do not change unrelated files.

---

## Main goal

Separate:

1. **Current canonical cycle event model**
2. **Legacy record compatibility support**

The repo should no longer behave as if `skipped_outside_overlap` is a normal active event type for the new system.

---

## What to fix

### 1. Define the canonical current cycle event model

Standardize the active/current event types used by the app.

The current model should reflect the new session-aware behavior.

Use a clean current model such as:
- `completed`
- `skipped`
- `failed`

If there are other valid active event types already in the repo, keep them only if they still belong to the new model.

Do **not** keep `skipped_outside_overlap` as part of the canonical active event set.

---

### 2. Preserve legacy support only as read compatibility

If old DB records may still contain `skipped_outside_overlap`, keep compatibility narrowly scoped.

That means:
- legacy event types may be recognized when reading historical records
- but they must **not** remain part of the active/current event model
- comments should clearly mark them as legacy-only compatibility handling

Do not let old overlap events drive current naming, current status logic, or current assumptions.

---

### 3. Clean repository/query logic

Audit and patch files such as:
- `src/repositories/cycleRepo.mongo.js`
- `src/server/routes/dashboard.js`

Fix any places where the repo still treats `skipped_outside_overlap` as a standard terminal event in the current model.

Refactor so:
- canonical terminal event types are clean
- legacy overlap skips are only handled through explicit compatibility paths where necessary
- comments explain the distinction

---

### 4. Clean dashboard/status logic

Patch dashboard/status rendering so the current UI/history layer reflects the new session-aware behavior.

Requirements:
- current status logic should not imply overlap-only scheduling
- current terminal status logic should rely on the canonical current event model
- legacy overlap records may still be translated for display if needed, but should be clearly treated as historical compatibility, not current runtime semantics

Keep the UI behavior stable.

---

### 5. Update tests for the cleanup

Add or update tests so the cleanup is protected.

At minimum cover:
- canonical terminal event model no longer includes `skipped_outside_overlap`
- legacy overlap records can still be read/displayed safely if compatibility is retained
- dashboard/repository logic prefers current canonical event types
- no regression in latest-cycle / terminal-cycle lookup behavior

Use the existing backend test setup.

Keep tests focused and practical.

---

## Files to inspect first

Start with:
- `src/repositories/cycleRepo.mongo.js`
- `src/server/routes/dashboard.js`

Then inspect any supporting files/tests that depend on those modules.

---

## Deliverables

Apply the edits directly in the repo.

When done, return:
1. **Changed files**
2. **What was cleaned up**
3. **How legacy compatibility is handled**
4. **Any assumptions**
5. **Any follow-up risks or optional improvements**

Do not stop at analysis. Make the code changes.

---

## Acceptance criteria

The work is complete only if all of the following are true:

- `skipped_outside_overlap` is no longer part of the canonical current event model
- any remaining handling of `skipped_outside_overlap` is explicitly legacy-only compatibility
- dashboard/status/repository logic uses the new session-aware current model
- current behavior does not imply overlap-only scheduling
- tests cover the cleanup and compatibility behavior
- no unrelated refactors are introduced
