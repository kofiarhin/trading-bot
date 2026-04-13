# Manual Cycle Trigger – Implementation Plan

Based on `_spec/manual-cycle-trigger-spec.md` and current codebase state.

---

## Current State Summary

| Area | What Exists |
|------|-------------|
| `runAutopilotCycle()` | Exists in `src/autopilot.js` — single runner, no `triggerSource` param yet |
| Runtime lock | Exists — `startCycleRuntime()` in `src/repositories/cycleRuntimeRepo.mongo.js` uses atomic MongoDB check; throws `CycleAlreadyRunningError` |
| `CycleRuntime` model | Exists in `src/models/CycleRuntime.js` — missing `triggerSource` / `triggeredBy` fields |
| `CycleLog` model | Exists in `src/models/CycleLog.js` — missing `triggerSource` field |
| Cron route | `POST /api/cycle/run` in `src/server/routes/cycle.js` — protected by `CRON_SECRET` bearer token |
| Manual route | Does not exist |
| Frontend cycle service | `client/src/services/cycle.js` — has `getRuntime()` and `runCycle()` but `runCycle()` hits the cron-protected endpoint |
| Runtime query hook | `client/src/hooks/queries/useCycleRuntime.js` — polls every 2s when running, 10s idle |
| Mutations folder | Does not exist — must create `client/src/hooks/mutations/` |
| Dashboard page | `client/src/pages/DashboardPage.jsx` — renders runtime; no trigger button yet |

---

## Phase 1 — Backend

### Step 1.1 — Add `triggerSource` to `CycleRuntime` model

**File:** `src/models/CycleRuntime.js`

Add two fields to the schema:
```js
triggerSource: { type: String, enum: ['cron', 'manual'], default: 'cron' },
triggeredBy:   { type: String, default: null },
```

No migration needed — existing documents will just show `null` values (Mongoose handles missing fields gracefully).

---

### Step 1.2 — Add `triggerSource` to `CycleLog` model

**File:** `src/models/CycleLog.js`

Add one field:
```js
triggerSource: { type: String, enum: ['cron', 'manual'], default: null },
```

---

### Step 1.3 — Thread `triggerSource` through `runAutopilotCycle()`

**File:** `src/autopilot.js`

Change the function signature to accept `triggerSource`:
```js
// Before
async function runAutopilotCycle(options = {})

// After
async function runAutopilotCycle(options = {}, triggerSource = 'cron')
```

Pass `triggerSource` into:
- `startCycleRuntime({ ..., triggerSource })` — so the live runtime doc carries it
- Any `CycleLog` writes that record `cycle_started` / `cycle_completed` events

The function's return value should include `triggerSource` so route handlers can echo it in responses.

> Do NOT change any risk/execution logic. `triggerSource` is metadata only.

---

### Step 1.4 — Update `startCycleRuntime()` to persist `triggerSource`

**File:** `src/repositories/cycleRuntimeRepo.mongo.js`

`startCycleRuntime(initialPayload)` already accepts a payload object. Ensure `triggerSource` and `triggeredBy` from that payload are written to the `CycleRuntime` document. No structural change to the lock logic — the existing atomic `findOneAndUpdate` with `status: { $ne: 'running' }` remains unchanged.

---

### Step 1.5 — Add `POST /api/cycle/manual-run` route

**File:** `src/server/routes/cycle.js`

Add a new handler below the existing `/run` handler:

```js
// POST /api/cycle/manual-run
// Called by the dashboard. No CRON_SECRET required.
// Auth: env flag (ALLOW_MANUAL_TRIGGER=true) for v1.
router.post('/manual-run', async (req, res) => {
  if (process.env.ALLOW_MANUAL_TRIGGER !== 'true') {
    return res.status(403).json({ ok: false, code: 'MANUAL_TRIGGER_DISABLED' });
  }

  try {
    await recoverStaleRunningCycle();

    // Fire and forget — return 202 immediately
    runAutopilotCycle({}, 'manual').catch((err) => {
      // Background errors are logged by runAutopilotCycle itself
    });

    const runtime = await getCycleRuntime();
    return res.status(202).json({
      ok: true,
      cycleId: runtime?.cycleId,
      status: 'running',
      triggerSource: 'manual',
    });
  } catch (err) {
    if (err.name === 'CycleAlreadyRunningError') {
      return res.status(409).json({
        ok: false,
        code: 'CYCLE_ALREADY_RUNNING',
        cycleId: err.cycleId,
      });
    }
    return res.status(500).json({ ok: false, code: 'CYCLE_RUN_FAILED', message: err.message });
  }
});
```

**Auth strategy for v1:** Env flag `ALLOW_MANUAL_TRIGGER=true`. Add to `.env.example`.

> Cron route (`/run`) stays untouched.

---

### Step 1.6 — Update `.env.example`

Add:
```
ALLOW_MANUAL_TRIGGER=true
```

---

### Step 1.7 — Backend tests

**File:** `server/tests/cycle/manualRun.test.js` (new file)

Cover:
1. `POST /api/cycle/manual-run` → 202 when idle
2. `POST /api/cycle/manual-run` → 409 when already running
3. `POST /api/cycle/manual-run` → 403 when `ALLOW_MANUAL_TRIGGER` is not `true`
4. `triggerSource: 'manual'` is written to the `CycleRuntime` document

Use Jest + Supertest. Mock `runAutopilotCycle` to avoid real execution in tests.

---

## Phase 2 — Frontend

### Step 2.1 — Add `manualRunCycle()` to `cycle.js` service

**File:** `client/src/services/cycle.js`

Add:
```js
manualRunCycle: () => api.post('/cycle/manual-run'),
```

Do not modify or remove `runCycle()` — that still calls the cron-protected endpoint.

---

### Step 2.2 — Create `useRunCycle` mutation hook

**File:** `client/src/hooks/mutations/useRunCycle.js` (new file — also create `mutations/` directory)

```js
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { cycleService } from '../../services/cycle';

export function useRunCycle() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: cycleService.manualRunCycle,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cycle', 'runtime'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard', 'activity'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard', 'summary'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard', 'decisions'] });
    },
  });
}
```

---

### Step 2.3 — Add `RunCycleButton` component

**File:** `client/src/components/RunCycleButton.jsx` (new file)

Props: none. Reads runtime status from `useCycleRuntime()`. Uses `useRunCycle()` mutation.

Button states:

| Condition | Label | Disabled | Style |
|-----------|-------|----------|-------|
| Idle (not pending, not running) | Run Cycle Now | No | Primary |
| `isPending` (mutation in flight) | Starting... | Yes | Muted |
| `isRunning` (runtime status = 'running') | Cycle Running | Yes | Muted |

User feedback (inline below button, no toast required for v1):
- Success → "Manual cycle started"
- 409 conflict → "Cycle already running"
- Other error → "Failed to start cycle"

Reset feedback message after 5 seconds.

```jsx
function RunCycleButton() {
  const { data: runtime } = useCycleRuntime();
  const { mutate, isPending, isError, isSuccess, error } = useRunCycle();
  const [message, setMessage] = useState(null);

  const isRunning = runtime?.status === 'running';

  const handleClick = () => {
    mutate(undefined, {
      onSuccess: () => setMessage('Manual cycle started'),
      onError: (err) => {
        const code = err?.response?.data?.code;
        setMessage(
          code === 'CYCLE_ALREADY_RUNNING'
            ? 'Cycle already running'
            : 'Failed to start cycle'
        );
      },
    });
  };

  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => setMessage(null), 5000);
    return () => clearTimeout(t);
  }, [message]);

  return (
    <div>
      <button onClick={handleClick} disabled={isPending || isRunning}>
        {isPending ? 'Starting...' : isRunning ? 'Cycle Running' : 'Run Cycle Now'}
      </button>
      {message && <p>{message}</p>}
    </div>
  );
}
```

Style with Tailwind to match existing dashboard button patterns.

---

### Step 2.4 — Place `RunCycleButton` in `DashboardPage`

**File:** `client/src/pages/DashboardPage.jsx`

Render `<RunCycleButton />` near the top of the page, adjacent to the cycle status header — not inside `LastCyclePanel` (keep that panel read-only).

Import and drop it in. No prop drilling needed — it is self-contained.

---

### Step 2.5 — Show `triggerSource` in Last Cycle and Activity Feed

**File(s):** Wherever `LastCyclePanel` and activity feed items are rendered.

If the `CycleRuntime` or activity items now include `triggerSource`, display it inline:
```
Cycle complete — manual
Cycle complete — cron
```

Only display if `triggerSource` is present in the data. No UI changes if the field is absent (backwards compatible).

---

## Phase 3 — Polish

### Step 3.1 — Improve cycle log messages

When `triggerSource === 'manual'`, prefix log entries:
```
[manual] Cycle started — cycleId: abc123
```

This helps distinguish manual runs in MongoDB logs without breaking existing cron log format.

---

### Step 3.2 — Show `triggerSource` on `GET /api/cycle/runtime`

`CycleRuntime` model already contains `triggerSource` after Phase 1. Verify the GET handler returns the full document (it should already, since it returns the raw runtime object). No code change expected — just verify.

---

## File Change Summary

### New Files
| File | Purpose |
|------|---------|
| `client/src/hooks/mutations/useRunCycle.js` | React Query mutation hook |
| `client/src/components/RunCycleButton.jsx` | Self-contained button component |
| `server/tests/cycle/manualRun.test.js` | Backend tests for manual route |

### Modified Files
| File | Change |
|------|--------|
| `src/models/CycleRuntime.js` | Add `triggerSource`, `triggeredBy` fields |
| `src/models/CycleLog.js` | Add `triggerSource` field |
| `src/autopilot.js` | Add `triggerSource` param, thread through runtime/log writes |
| `src/repositories/cycleRuntimeRepo.mongo.js` | Pass `triggerSource` through to document write |
| `src/server/routes/cycle.js` | Add `POST /manual-run` handler |
| `client/src/services/cycle.js` | Add `manualRunCycle()` call |
| `client/src/pages/DashboardPage.jsx` | Mount `<RunCycleButton />` |
| `.env.example` | Add `ALLOW_MANUAL_TRIGGER=true` |

---

## Key Constraints

- Cron route (`POST /api/cycle/run`) stays untouched
- `runAutopilotCycle()` remains the single runner — no duplicate logic
- Risk guards, position limits, session rules are not bypassed — `triggerSource` is metadata only
- Manual run response is async (202) — frontend polls via existing `useCycleRuntime` hook
- No queue — hard lock; if running, return 409
- `ALLOW_MANUAL_TRIGGER` env flag gates the route for v1 (simple, easy to flip off)

---

## Implementation Order

```
Phase 1: Backend
  1.1 CycleRuntime model fields
  1.2 CycleLog model field
  1.3 runAutopilotCycle() signature
  1.4 cycleRuntimeRepo startCycleRuntime()
  1.5 /manual-run route
  1.6 .env.example
  1.7 Backend tests

Phase 2: Frontend
  2.1 cycleService.manualRunCycle()
  2.2 useRunCycle mutation hook
  2.3 RunCycleButton component
  2.4 DashboardPage wiring
  2.5 triggerSource display

Phase 3: Polish
  3.1 Log prefixes
  3.2 Verify runtime GET returns triggerSource
```
