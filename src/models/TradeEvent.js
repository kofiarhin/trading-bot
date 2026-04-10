import mongoose from 'mongoose';

const tradeEventSchema = new mongoose.Schema(
  {
    eventId: { type: String, required: true, unique: true, index: true },
    id: { type: String, index: true },
    type: { type: String, required: true, index: true },
    tradeId: { type: String, index: true },
    symbol: { type: String, index: true },
    strategyName: String,
    timestamp: { type: String, index: true },
    reason: String,
    pnl: Number,
    payload: { type: mongoose.Schema.Types.Mixed, default: null },
    status: String,
    date: { type: String, index: true },
  },
  { collection: 'trade_events', timestamps: false, strict: false },
);

export default mongoose.models.TradeEvent || mongoose.model('TradeEvent', tradeEventSchema);
