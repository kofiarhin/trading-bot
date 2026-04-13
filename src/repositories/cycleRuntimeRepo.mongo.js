import CycleRuntime from '../models/CycleRuntime.js';
import { CYCLE_STAGES, stageToProgress } from '../autopilot/cycleStages.js';

const RUNTIME_KEY = 'cycle-runtime';

function nowIso() {
  return new Date().toISOString();
}

function stripMongo(doc) {
  if (!doc) return null;
  const { _id, __v, ...rest } = doc;
  return rest;
}

export async function getCycleRuntime() {
  const doc = await CycleRuntime.findOne({ key: RUNTIME_KEY }).lean();
  if (doc) return stripMongo(doc);

  const created = await CycleRuntime.create({
    key: RUNTIME_KEY,
    status: 'idle',
    stage: null,
    progressPct: 0,
    updatedAt: nowIso(),
    metrics: {},
  });
  return stripMongo(created.toObject());
}

export async function startCycleRuntime(initialPayload = {}) {
  const timestamp = nowIso();
  const metrics = initialPayload.metrics ?? {};

  await CycleRuntime.updateOne(
    { key: RUNTIME_KEY },
    {
      $setOnInsert: {
        key: RUNTIME_KEY,
        status: 'idle',
        stage: null,
        progressPct: 0,
        updatedAt: timestamp,
        metrics: {},
      },
    },
    { upsert: true },
  );

  const doc = await CycleRuntime.findOneAndUpdate(
    { key: RUNTIME_KEY, status: { $ne: 'running' } },
    {
      $set: {
        key: RUNTIME_KEY,
        status: 'running',
        stage: CYCLE_STAGES.STARTING,
        progressPct: stageToProgress(CYCLE_STAGES.STARTING),
        startedAt: timestamp,
        completedAt: null,
        failedAt: null,
        updatedAt: timestamp,
        metrics,
        lastError: null,
      },
    },
    { new: true },
  ).lean();

  return stripMongo(doc);
}

export async function updateCycleRuntime(patch = {}) {
  const timestamp = nowIso();
  const stage = patch.stage;
  const computedProgress = stage ? stageToProgress(stage) : null;

  const $set = {
    updatedAt: timestamp,
  };

  if (patch.status) $set.status = patch.status;
  if (stage) {
    $set.stage = stage;
    $set.progressPct = patch.progressPct ?? computedProgress;
  } else if (patch.progressPct != null) {
    $set.progressPct = patch.progressPct;
  }

  if (patch.metrics) {
    $set.metrics = patch.metrics;
  }

  const doc = await CycleRuntime.findOneAndUpdate(
    { key: RUNTIME_KEY },
    { $set },
    { new: true },
  ).lean();

  return stripMongo(doc);
}

export async function completeCycleRuntime(summaryPatch = {}) {
  const timestamp = nowIso();
  const doc = await CycleRuntime.findOneAndUpdate(
    { key: RUNTIME_KEY },
    {
      $set: {
        status: 'completed',
        stage: CYCLE_STAGES.COMPLETED,
        progressPct: 100,
        completedAt: timestamp,
        failedAt: null,
        updatedAt: timestamp,
        metrics: summaryPatch.metrics ?? {},
      },
    },
    { new: true },
  ).lean();

  return stripMongo(doc);
}

export async function failCycleRuntime(errorPatch = {}) {
  const timestamp = nowIso();
  const doc = await CycleRuntime.findOneAndUpdate(
    { key: RUNTIME_KEY },
    {
      $set: {
        status: 'failed',
        stage: CYCLE_STAGES.FAILED,
        progressPct: 100,
        failedAt: timestamp,
        updatedAt: timestamp,
        lastError: {
          message: errorPatch.message ?? 'Cycle failed',
          stack: errorPatch.stack ?? null,
          context: errorPatch.context ?? null,
        },
      },
    },
    { new: true },
  ).lean();

  return stripMongo(doc);
}
