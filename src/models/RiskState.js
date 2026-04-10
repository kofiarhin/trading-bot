import mongoose from 'mongoose';

// Singleton document — one record per trading day. Upserted by date.
const riskStateSchema = new mongoose.Schema(
  {
    date: { type: String, required: true, unique: true, index: true },
    dailyRealizedLoss: { type: Number, default: 0 },
    cooldowns: { type: Map, of: String, default: {} },
  },
  { collection: 'risk_state', timestamps: false },
);

export default mongoose.models.RiskState || mongoose.model('RiskState', riskStateSchema);
