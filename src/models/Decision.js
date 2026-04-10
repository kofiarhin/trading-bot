import mongoose from 'mongoose';

const decisionSchema = new mongoose.Schema(
  {
    timestamp: { type: String, index: true },
    recordedAt: String,
    symbol: { type: String, required: true, index: true },
    assetClass: String,
    approved: { type: Boolean, index: true },
    reason: String,
    timeframe: String,
    strategyName: String,
    closePrice: Number,
    entryPrice: Number,
    breakoutLevel: Number,
    atr: Number,
    volumeRatio: Number,
    distanceToBreakoutPct: Number,
    stopLoss: Number,
    takeProfit: Number,
    quantity: Number,
    riskAmount: Number,
    // date string (ET) for day-scoped queries e.g. "2026-04-10"
    date: { type: String, required: true, index: true },
  },
  { collection: 'decisions', timestamps: false, strict: false },
);

export default mongoose.models.Decision || mongoose.model('Decision', decisionSchema);
