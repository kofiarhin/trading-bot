import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

let mongoServer = null;

export async function startMongoHarness(dbName = 'trading-bot-test') {
  mongoServer = await MongoMemoryServer.create();
  process.env.MONGO_URI = mongoServer.getUri();
  process.env.MONGO_DB_NAME = dbName;

  const { connectMongo } = await import('../../src/db/connectMongo.js');
  await connectMongo();
}

export async function clearMongoHarness() {
  if (mongoose.connection.readyState !== 1 || !mongoose.connection.db) {
    return;
  }

  await mongoose.connection.db.dropDatabase();
}

export async function stopMongoHarness() {
  const { disconnectMongo } = await import('../../src/db/connectMongo.js');
  await disconnectMongo();

  if (mongoServer) {
    await mongoServer.stop();
    mongoServer = null;
  }
}
