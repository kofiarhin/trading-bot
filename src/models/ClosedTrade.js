import mongoose from 'mongoose';

const metricsSchema = new mongoose.Schema(
  {
    closePrice: Number,
    breakoutLevel: Number,
    atr: Number,
    volumeRatio: Number,
    distanceToBreakoutPct: Number,
  },
  { _id: false },
);

const closedTradeSchema = new mongoose.Schema(
  {
    tradeId: { type: String, required: true, unique: true, index: true },
    symbol: { type: String, required: true, index: true },
    normalizedSymbol: { type: String, index: true },
    assetClass: String,
    strategyName: String,
    entryPrice: Number,
    stopLoss: Number,
    takeProfit: Number,
    quantity: Number,
    riskAmount: Number,
    status: { type: String, default: 'closed' },
    openedAt: String,
    closedAt: { type: String, index: true },
    exitPrice: Number,
    pnl: Number,
    pnlPct: Number,
    exitReason: String,
    metrics: metricsSchema,
    decisionId: String,
    side: String,
    pendingAt: String,
    brokerOrderId: String,
    brokerClientOrderId: String,
    orphaned: { type: Boolean, default: false },
    source: String,
    notes: String,
    updatedAt: String,
  },
  { collection: 'closed_trades', timestamps: false },
);

export default mongoose.models.ClosedTrade || mongoose.model('ClosedTrade', closedTradeSchema);
