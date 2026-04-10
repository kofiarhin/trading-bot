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

const openTradeSchema = new mongoose.Schema(
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
    status: {
      type: String,
      enum: ['pending', 'open', 'canceled'],
      default: 'pending',
      index: true,
    },
    openedAt: String,
    exitPrice: Number,
    metrics: metricsSchema,
    decisionId: String,
    side: String,
    pendingAt: String,
    brokerOrderId: String,
    brokerClientOrderId: String,
    orphaned: { type: Boolean, default: false },
    source: String,
    notes: String,
    cancelReason: String,
    updatedAt: String,
  },
  { collection: 'open_trades', timestamps: false },
);

export default mongoose.models.OpenTrade || mongoose.model('OpenTrade', openTradeSchema);
