import mongoose from 'mongoose';

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
    orphaned: { type: Boolean, default: false },
    metrics: { type: mongoose.Schema.Types.Mixed, default: {} },
    decisionId: String,
    side: String,
    pendingAt: String,
    brokerOrderId: String,
    brokerClientOrderId: String,
    source: String,
    notes: String,
    updatedAt: String,
  },
  { collection: 'closed_trades', timestamps: false, strict: false },
);

// Compound index for per-symbol history and date-range queries
closedTradeSchema.index({ symbol: 1, closedAt: -1 });

export default mongoose.models.ClosedTrade || mongoose.model('ClosedTrade', closedTradeSchema);
