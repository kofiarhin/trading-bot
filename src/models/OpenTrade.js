import mongoose from 'mongoose';

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
    brokerOrderId: String,
    brokerClientOrderId: String,
    orphaned: { type: Boolean, default: false },
    metrics: { type: mongoose.Schema.Types.Mixed, default: {} },
    exitPrice: Number,
    decisionId: String,
    side: String,
    pendingAt: String,
    source: String,
    notes: String,
    cancelReason: String,
    updatedAt: String,
  },
  { collection: 'open_trades', timestamps: false, strict: false },
);

export default mongoose.models.OpenTrade || mongoose.model('OpenTrade', openTradeSchema);
