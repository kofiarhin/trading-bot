import mongoose from 'mongoose';

const cycleRunSchema = new mongoose.Schema(
  {
    // For log events: type describes the event kind (cycle_start, cycle_complete, skipped, etc.)
    type: { type: String, index: true },
    timestamp: { type: String, index: true },
    recordedAt: String,
    // date string (ET) for day-scoped queries e.g. "2026-04-10"
    date: { type: String, required: true, index: true },
    // Completed cycle fields
    scanned: Number,
    approved: Number,
    placed: Number,
    errors: Number,
    skipped: Number,
    // Skipped cycle fields
    reason: String,
  },
  { collection: 'cycle_runs', timestamps: false, strict: false },
);

export default mongoose.models.CycleRun || mongoose.model('CycleRun', cycleRunSchema);
