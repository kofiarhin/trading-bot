import mongoose from 'mongoose';

const riskStateSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, index: true, default: 'risk-state' },
    date: { type: String, index: true },
    halted: { type: Boolean, default: false },
    dailyLossPct: { type: Number, default: 0 },
    dailyRealizedLoss: { type: Number, default: 0 },
    cooldowns: { type: Map, of: String, default: {} },
    totalOpenRisk: { type: Number, default: 0 },
    drawdownThrottleActive: { type: Boolean, default: false },
    updatedAt: String,
  },
  { collection: 'risk_state', timestamps: false, strict: false },
);

export default mongoose.models.RiskState || mongoose.model('RiskState', riskStateSchema);
