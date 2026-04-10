import mongoose from 'mongoose';

const cycleLogSchema = new mongoose.Schema(
  {
    cycleId: { type: String, index: true },
    type: { type: String, index: true },
    timestamp: { type: String, index: true },
    recordedAt: String,
    date: { type: String, required: true, index: true },
    dryRun: Boolean,
    startedAt: String,
    endTime: String,
    scanned: Number,
    approved: Number,
    rejected: Number,
    placed: Number,
    errors: Number,
    reason: String,
    payload: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  {
    collection: 'cycle_runs',
    timestamps: false,
    strict: false,
    suppressReservedKeysWarning: true,
  },
);

export default mongoose.models.CycleLog || mongoose.model('CycleLog', cycleLogSchema);
