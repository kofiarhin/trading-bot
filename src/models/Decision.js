import mongoose from 'mongoose';

const decisionSchema = new mongoose.Schema(
  {
    decisionId: { type: String, index: true },
    timestamp: { type: String, index: true },
    recordedAt: String,
    symbol: { type: String, required: true, index: true },
    normalizedSymbol: { type: String, index: true },
    assetClass: String,
    approved: { type: Boolean, index: true },
    reason: String,
    timeframe: String,
    strategyName: String,
    entryPrice: Number,
    stopLoss: Number,
    takeProfit: Number,
    quantity: Number,
    riskAmount: Number,
    riskReward: Number,
    blockers: { type: [String], default: [] },
    metrics: { type: mongoose.Schema.Types.Mixed, default: {} },
    closePrice: Number,
    breakoutLevel: Number,
    atr: Number,
    volumeRatio: Number,
    distanceToBreakoutPct: Number,
    setupScore: Number,
    setupGrade: String,
    scoreBreakdown: {
      momentum: Number,
      volume: Number,
      atrQuality: Number,
      riskReward: Number,
    },
    rejectionClass: String,
    context: { type: mongoose.Schema.Types.Mixed, default: {} },
    // v2 pipeline fields
    cycleId: { type: String, index: true },
    stage: { type: String },               // "pre_filter" | "scored" | "shortlisted" | "strategy" | "risk" | "execution"
    rank: { type: Number },
    shortlisted: { type: Boolean, default: false },
    rankedOut: { type: Boolean, default: false },
    rejectStage: { type: String },         // "pre_filter" | "strategy" | null
    date: { type: String, required: true, index: true },
  },
  { collection: 'decisions', timestamps: false, strict: false },
);

// Compound indexes for common dashboard queries
decisionSchema.index({ date: 1, timestamp: -1 });
decisionSchema.index({ date: 1, approved: 1, timestamp: -1 });
decisionSchema.index({ normalizedSymbol: 1, timestamp: -1 });
decisionSchema.index({ cycleId: 1, shortlisted: 1 });

export default mongoose.models.Decision || mongoose.model('Decision', decisionSchema);
