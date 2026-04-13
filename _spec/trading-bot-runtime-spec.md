# Trading Bot – Real-Time Execution Spec

## Overview
This document defines the implementation required to convert the trading bot from a time-bound loop to an event-driven execution model with live dashboard state.

---

## Core Change
Old:
- 15-minute loop execution model

New:
- Trigger-based execution (cron every 10 minutes)
- Immediate processing
- Live runtime state exposed to dashboard

---

## Backend Changes

### 1. Cycle Runtime Model
Create `src/models/CycleRuntime.js`

Tracks:
- status (idle, running, completed, failed)
- stage
- timestamps
- metrics (scanned, approved, etc.)

---

### 2. Runtime Repository
Create:
`src/repositories/cycleRuntimeRepo.mongo.js`

Functions:
- getCycleRuntime
- startCycleRuntime
- updateCycleRuntime
- completeCycleRuntime
- failCycleRuntime

---

### 3. Autopilot Updates
File: `src/autopilot.js`

Add stage tracking:

Stages:
- starting
- syncing_broker
- monitoring_positions
- fetching_market_data
- evaluating_signals
- applying_risk_guards
- placing_orders
- final_sync
- completed
- failed

---

### 4. Cycle API
Create:
`src/server/routes/cycle.js`

Endpoints:

POST /api/cycle/run  
GET /api/cycle/runtime  

---

### 5. Concurrency Guard
Prevent multiple cycles running at once.

---

### 6. Dashboard Integration
Update:
`src/server/routes/dashboard.js`

Use runtime state instead of inferred cycle status.

---

## Frontend Changes

### 1. Runtime Hook
Create:
`useCycleRuntime.js`

---

### 2. Progress Bar
Create:
`CycleProgressBar.jsx`

- visible only when running
- uses progressPct
- animated

---

### 3. Dashboard Updates
Update:
- DashboardPage.jsx
- LastCyclePanel.jsx
- ActivityFeed.jsx

---

## API Contract

### GET /api/cycle/runtime
Returns:
- status
- stage
- progressPct
- metrics

---

## Execution Flow

trigger → monitor → scan → analyze → decide → risk → execute → log → complete

---

## Testing

Backend:
- cycle runtime tests
- trigger endpoint tests

Frontend:
- progress bar visibility
- runtime state rendering

---

## Deployment

Use Heroku Scheduler:
- trigger POST /api/cycle/run every 10 minutes

---

## Summary

System becomes:
- event-driven
- fast execution
- state-aware
- dashboard interactive
