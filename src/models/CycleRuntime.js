import mongoose from 'mongoose';

const cycleRuntimeSchema = new mongoose.Schema(
  {
    singletonKey: { type: String, required: true, unique: true, index: true, default: 'cycle-runtime' },
    cycleId: { type: String, default: null },
    status: {
      type: String,
      enum: ['idle', 'running', 'completed', 'failed'],
      required: true,
      default: 'idle',
      index: true,
    },
    stage: { type: String, default: null },
    message: { type: String, default: null },
    session: { type: String, default: null },
    dryRun: { type: Boolean, default: false },
    symbolCount: { type: Number, default: 0 },
    scanned: { type: Number, default: 0 },
    approved: { type: Number, default: 0 },
    rejected: { type: Number, default: 0 },
    placed: { type: Number, default: 0 },
    errors: { type: Number, default: 0 },
    currentSymbol: { type: String, default: null },
    progressPct: { type: Number, default: 0 },
    startedAt: { type: String, default: null },
    endedAt: { type: String, default: null },
    lastCompletedAt: { type: String, default: null },
    heartbeatAt: { type: String, default: null },
    lastError: {
      message: { type: String, default: null },
      stack: { type: String, default: null },
      context: { type: mongoose.Schema.Types.Mixed, default: null },
    },
  },
  {
    collection: 'cycle_runtime',
    timestamps: false,
    strict: false,
    suppressReservedKeysWarning: true,
  },
);

export default mongoose.models.CycleRuntime || mongoose.model('CycleRuntime', cycleRuntimeSchema);
