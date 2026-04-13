import mongoose from 'mongoose';

const cycleRuntimeSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, index: true, default: 'cycle-runtime' },
    status: {
      type: String,
      enum: ['idle', 'running', 'completed', 'failed'],
      required: true,
      default: 'idle',
      index: true,
    },
    stage: { type: String, default: null },
    progressPct: { type: Number, default: 0 },
    startedAt: { type: String, default: null },
    completedAt: { type: String, default: null },
    failedAt: { type: String, default: null },
    updatedAt: { type: String, default: null },
    metrics: { type: mongoose.Schema.Types.Mixed, default: {} },
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
