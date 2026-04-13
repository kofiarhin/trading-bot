# Manual Cycle Trigger – Full Implementation Spec

## Goal
Add a manual “Run Cycle Now” trigger that can launch a cycle immediately between scheduled cron runs, while keeping the existing 15-minute automated cycle behavior unchanged.

---

## Core Principle
Use a **single shared cycle runner**:
- cron → runAutopilotCycle('cron')
- manual → API → runAutopilotCycle('manual')

No duplicate logic.

---

## Product Behavior

### Dashboard Button
**Run Cycle Now**

#### Idle
- Enabled
- Click starts cycle immediately
- UI switches to running state

#### Running
- Disabled
- Label: “Cycle Running”

#### Responses
- Success → “Manual cycle started”
- Already running → “Cycle already running”
- Failure → “Failed to start cycle”

---

## Backend Design

### 1. Shared Cycle Runner
`runAutopilotCycle()` remains the single source of truth.

### 2. Runtime Lock (CRITICAL)
States:
- idle
- running

Behavior:
- Reject new cycle if one is running (`409`)

---

### 3. Routes

#### Existing (cron)
POST /api/cycle/run  
- Protected by CRON_SECRET  
- Used only by server/cron

#### New (manual)
POST /api/cycle/manual-run  
- Used by dashboard  
- Protected by app auth (or env flag temporarily)

---

### 4. Trigger Metadata

Add to runtime + logs:
- triggerSource: 'cron' | 'manual'
- triggeredBy (optional)

---

### 5. Response Strategy

#### Recommended (async start)
Return:
```
202 Accepted
{
  ok: true,
  cycleId,
  status: "running",
  triggerSource: "manual"
}
```

Frontend uses polling for updates.

---

### 6. Overlap Handling

If cycle already running:
```
409 Conflict
{
  ok: false,
  code: "CYCLE_ALREADY_RUNNING"
}
```

---

## Frontend Design

### 1. Mutation Hook
`useRunCycle()`
- calls API
- invalidates:
  - cycle runtime
  - dashboard data

---

### 2. Button States

| State | Label | Disabled |
|------|------|--------|
| Idle | Run Cycle Now | No |
| Pending | Starting... | Yes |
| Running | Cycle Running | Yes |

---

### 3. Query Invalidation
After success:
- runtime
- activity
- summary
- decisions

---

### 4. Show Trigger Source

Display in:
- Last Cycle
- Activity Feed

Example:
```
Cycle started — manual
Cycle complete — manual
```

---

## Data Model Changes

### CycleRuntime
Add:
- triggerSource
- triggeredBy

### Events
Add:
- triggerSource

---

## Risk Rules

Manual trigger MUST NOT bypass:
- risk guards
- session rules
- position limits
- stop/target logic

Manual = run now  
NOT = override rules

---

## Worker Compatibility

Cron remains unchanged.

If overlap:
- cron attempt fails
- no second cycle runs

---

## Edge Cases

1. Manual before cron → cron skipped
2. Double click → backend blocks
3. Server restart → stale recovery
4. API failure → cycle fails safely

---

## Testing

### Backend
- manual route success
- overlap rejection
- source tagging
- failure handling

### Frontend
- button states
- mutation flow
- query invalidation

---

## Implementation Order

### Phase 1 (Backend)
- add triggerSource
- add manual route
- keep lock logic

### Phase 2 (Frontend)
- add mutation hook
- add button
- wire states

### Phase 3 (Polish)
- show source in UI
- improve logs

---

## Final Recommendation

Ship v1 with:
- shared runner
- manual endpoint
- hard lock (no queue)
- dashboard button
- trigger source tracking

---

## Summary

You are adding **operator control** to an automated system.

Key rule:
> Manual trigger must behave exactly like cron — just sooner.
