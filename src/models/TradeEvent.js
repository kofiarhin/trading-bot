import mongoose from 'mongoose';

const tradeEventSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true, index: true },
    type: { type: String, required: true, index: true },
    tradeId: { type: String, index: true },
    symbol: { type: String, index: true },
    timestamp: { type: String, index: true },
    status: String,
    strategyName: String,
    // date string (ET) for day-scoped queries e.g. "2026-04-10"
    date: { type: String, index: true },
  },
  { collection: 'trade_events', timestamps: false, strict: false },
);

export default mongoose.models.TradeEvent || mongoose.model('TradeEvent', tradeEventSchema);
