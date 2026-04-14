import CycleRuntime from '../models/CycleRuntime.js';
import { CYCLE_STAGES, stageToProgress } from '../autopilot/cycleStages.js';

const RUNTIME_KEY = 'cycle-runtime';
const DEFAULT_STALE_MINUTES = 5;

export class CycleAlreadyRunningError extends Error {
  constructor(cycleId) {
    super('Cycle already running');
    this.name = 'CycleAlreadyRunningError';
    this.code = 'CYCLE_ALREADY_RUNNING';
    this.cycleId = cycleId ?? null;
  }
}

function nowIso() {
  return new Date().toISOString();
}

function staleCutoffIso() {
  const staleMinutes = Number(process.env.CYCLE_RUNTIME_STALE_MINUTES ?? DEFAULT_STALE_MINUTES);
  const safeMinutes = Number.isFinite(staleMinutes) && staleMinutes > 0 ? staleMinutes : DEFAULT_STALE_MINUTES;
  return new Date(Date.now() - safeMinutes * 60_000).toISOString();
}

function toInt(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeRuntime(doc) {
  if (!doc) return null;
  const { _id, __v, ...rest } = doc;
  return {
    singletonKey: rest.singletonKey ?? rest.key ?? RUNTIME_KEY,
    cycleId: rest.cycleId ?? null,
    status: rest.status ?? 'idle',
    stage: rest.stage ?? null,
    message: rest.message ?? null,
    session: rest.session ?? null,
    dryRun: Boolean(rest.dryRun),
    symbolCount: toInt(rest.symbolCount, 0),
    scanned: toInt(rest.scanned ?? rest.metrics?.scanned, 0),
    approved: toInt(rest.approved ?? rest.metrics?.approved, 0),
    rejected: toInt(rest.rejected ?? rest.metrics?.rejected, 0),
    placed: toInt(rest.placed ?? rest.metrics?.placed, 0),
    errors: toInt(rest.errors ?? rest.metrics?.errors, 0),
    preFiltered: toInt(rest.preFiltered, 0),
    shortlisted: toInt(rest.shortlisted, 0),
    rankedOut: toInt(rest.rankedOut, 0),
    currentSymbol: rest.currentSymbol ?? null,
    progressPct: toInt(rest.progressPct, 0),
    startedAt: rest.startedAt ?? null,
    endedAt: rest.endedAt ?? rest.completedAt ?? rest.failedAt ?? null,
    lastCompletedAt: rest.lastCompletedAt ?? rest.completedAt ?? null,
    heartbeatAt: rest.heartbeatAt ?? rest.updatedAt ?? null,
    triggerSource: rest.triggerSource ?? null,
    triggeredBy: rest.triggeredBy ?? null,
    lastError: rest.lastError ?? null,
    metrics: {
      scanned: toInt(rest.scanned ?? rest.metrics?.scanned, 0),
      approved: toInt(rest.approved ?? rest.metrics?.approved, 0),
      rejected: toInt(rest.rejected ?? rest.metrics?.rejected, 0),
      placed: toInt(rest.placed ?? rest.metrics?.placed, 0),
      errors: toInt(rest.errors ?? rest.metrics?.errors, 0),
      symbolCount: toInt(rest.symbolCount, 0),
      preFiltered: toInt(rest.preFiltered, 0),
      shortlisted: toInt(rest.shortlisted, 0),
      rankedOut: toInt(rest.rankedOut, 0),
    },
  };
}

async function ensureRuntimeDocument() {
  await CycleRuntime.updateOne(
    { singletonKey: RUNTIME_KEY },
    {
      $setOnInsert: {
        singletonKey: RUNTIME_KEY,
        status: 'idle',
        stage: null,
        progressPct: 0,
        heartbeatAt: nowIso(),
      },
    },
    { upsert: true },
  );
}

export async function recoverStaleRunningCycle() {
  const timestamp = nowIso();
  const recovered = await CycleRuntime.findOneAndUpdate(
    {
      singletonKey: RUNTIME_KEY,
      status: 'running',
      heartbeatAt: { $lte: staleCutoffIso() },
    },
    {
      $set: {
        status: 'failed',
        stage: CYCLE_STAGES.FAILED,
        message: 'Cycle failed (stale runtime recovered)',
        endedAt: timestamp,
        progressPct: 100,
        heartbeatAt: timestamp,
        currentSymbol: null,
      },
      $setOnInsert: {
        singletonKey: RUNTIME_KEY,
      },
      $inc: {
        errors: 1,
      },
    },
    { new: true },
  ).lean();

  if (!recovered) return null;

  return normalizeRuntime(recovered);
}

export async function getCycleRuntime({ recoverStale = true } = {}) {
  await ensureRuntimeDocument();
  if (recoverStale) {
    await recoverStaleRunningCycle();
  }
  const doc = await CycleRuntime.findOne({ singletonKey: RUNTIME_KEY }).lean();
  return normalizeRuntime(doc);
}

export async function startCycleRuntime(initialPayload = {}) {
  const timestamp = nowIso();
  await ensureRuntimeDocument();
  await recoverStaleRunningCycle();

  const cycleId = initialPayload.cycleId ?? null;
  const stage = initialPayload.stage ?? CYCLE_STAGES.STARTING;

  const startedDoc = await CycleRuntime.findOneAndUpdate(
    { singletonKey: RUNTIME_KEY, status: { $ne: 'running' } },
    {
      $set: {
        singletonKey: RUNTIME_KEY,
        cycleId,
        status: 'running',
        stage,
        message: initialPayload.message ?? 'Cycle started',
        progressPct: initialPayload.progressPct ?? stageToProgress(stage),
        session: initialPayload.session ?? null,
        dryRun: Boolean(initialPayload.dryRun),
        symbolCount: toInt(initialPayload.symbolCount, 0),
        scanned: toInt(initialPayload.scanned, 0),
        approved: toInt(initialPayload.approved, 0),
        rejected: toInt(initialPayload.rejected, 0),
        placed: toInt(initialPayload.placed, 0),
        errors: toInt(initialPayload.errors, 0),
        preFiltered: toInt(initialPayload.preFiltered, 0),
        shortlisted: toInt(initialPayload.shortlisted, 0),
        rankedOut: toInt(initialPayload.rankedOut, 0),
        currentSymbol: initialPayload.currentSymbol ?? null,
        startedAt: initialPayload.startedAt ?? timestamp,
        endedAt: null,
        heartbeatAt: timestamp,
        triggerSource: initialPayload.triggerSource ?? 'cron',
        triggeredBy: initialPayload.triggeredBy ?? null,
        lastError: null,
      },
    },
    { new: true },
  ).lean();

  if (!startedDoc) {
    const current = await CycleRuntime.findOne({ singletonKey: RUNTIME_KEY }).lean();
    throw new CycleAlreadyRunningError(current?.cycleId ?? null);
  }

  return normalizeRuntime(startedDoc);
}

export async function updateCycleRuntime(patch = {}) {
  const timestamp = nowIso();
  const filter = { singletonKey: RUNTIME_KEY };
  if (patch.cycleId) filter.cycleId = patch.cycleId;

  const stage = patch.stage ?? null;
  const $set = {
    heartbeatAt: patch.heartbeatAt ?? timestamp,
  };

  if (patch.status) $set.status = patch.status;
  if (stage) {
    $set.stage = stage;
    $set.progressPct = patch.progressPct ?? stageToProgress(stage);
  } else if (patch.progressPct != null) {
    $set.progressPct = patch.progressPct;
  }

  if (patch.message != null) $set.message = patch.message;
  if (patch.session != null) $set.session = patch.session;
  if (patch.dryRun != null) $set.dryRun = Boolean(patch.dryRun);
  if (patch.symbolCount != null) $set.symbolCount = toInt(patch.symbolCount, 0);
  if (patch.scanned != null) $set.scanned = toInt(patch.scanned, 0);
  if (patch.approved != null) $set.approved = toInt(patch.approved, 0);
  if (patch.rejected != null) $set.rejected = toInt(patch.rejected, 0);
  if (patch.placed != null) $set.placed = toInt(patch.placed, 0);
  if (patch.errors != null) $set.errors = toInt(patch.errors, 0);
  if (patch.preFiltered != null) $set.preFiltered = toInt(patch.preFiltered, 0);
  if (patch.shortlisted != null) $set.shortlisted = toInt(patch.shortlisted, 0);
  if (patch.rankedOut != null) $set.rankedOut = toInt(patch.rankedOut, 0);
  if (patch.currentSymbol !== undefined) $set.currentSymbol = patch.currentSymbol;

  const doc = await CycleRuntime.findOneAndUpdate(filter, { $set }, { new: true }).lean();
  return normalizeRuntime(doc);
}

export async function completeCycleRuntime(summaryPatch = {}) {
  const timestamp = nowIso();
  const filter = { singletonKey: RUNTIME_KEY };
  if (summaryPatch.cycleId) filter.cycleId = summaryPatch.cycleId;

  const doc = await CycleRuntime.findOneAndUpdate(
    filter,
    {
      $set: {
        status: 'completed',
        stage: CYCLE_STAGES.COMPLETED,
        progressPct: 100,
        message: summaryPatch.message ?? 'Cycle complete',
        endedAt: timestamp,
        lastCompletedAt: timestamp,
        heartbeatAt: timestamp,
        currentSymbol: null,
        scanned: toInt(summaryPatch.scanned, 0),
        approved: toInt(summaryPatch.approved, 0),
        rejected: toInt(summaryPatch.rejected, 0),
        placed: toInt(summaryPatch.placed, 0),
        errors: toInt(summaryPatch.errors, 0),
        preFiltered: toInt(summaryPatch.preFiltered, 0),
        shortlisted: toInt(summaryPatch.shortlisted, 0),
        rankedOut: toInt(summaryPatch.rankedOut, 0),
      },
    },
    { new: true },
  ).lean();

  return normalizeRuntime(doc);
}

export async function failCycleRuntime(errorPatch = {}) {
  const timestamp = nowIso();
  const filter = { singletonKey: RUNTIME_KEY };
  if (errorPatch.cycleId) filter.cycleId = errorPatch.cycleId;

  const doc = await CycleRuntime.findOneAndUpdate(
    filter,
    {
      $set: {
        status: 'failed',
        stage: CYCLE_STAGES.FAILED,
        progressPct: 100,
        message: errorPatch.message ?? 'Cycle failed',
        endedAt: timestamp,
        heartbeatAt: timestamp,
        currentSymbol: null,
        lastError: {
          message: errorPatch.message ?? 'Cycle failed',
          stack: errorPatch.stack ?? null,
          context: errorPatch.context ?? null,
        },
      },
      $inc: {
        errors: 1,
      },
    },
    { new: true },
  ).lean();

  return normalizeRuntime(doc);
}
