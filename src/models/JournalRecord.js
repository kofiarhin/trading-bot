import mongoose from 'mongoose';

const journalRecordSchema = new mongoose.Schema(
  {
    date: { type: String, required: true, index: true },
    recordType: { type: String, required: true, index: true },
    timestamp: { type: String, index: true },
    payload: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { collection: 'journal_records', timestamps: false, strict: false },
);

export default mongoose.models.JournalRecord || mongoose.model('JournalRecord', journalRecordSchema);
