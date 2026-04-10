import mongoose from 'mongoose';

let connectionPromise = null;

export async function connectMongo() {
  if (mongoose.connection.readyState === 1) return;

  const uri = process.env.MONGO_URI;
  if (!uri) {
    throw new Error('MONGO_URI environment variable is required');
  }

  if (!connectionPromise) {
    connectionPromise = mongoose.connect(uri, {
      dbName: process.env.MONGO_DB_NAME || 'trading-bot',
    });
  }

  await connectionPromise;
}

export default connectMongo;
