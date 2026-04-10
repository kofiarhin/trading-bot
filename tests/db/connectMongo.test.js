import { afterAll, afterEach, beforeAll, describe, expect, it } from '@jest/globals';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

let mongoServer;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
});

afterEach(async () => {
  const { disconnectMongo } = await import('../../src/db/connectMongo.js');
  await disconnectMongo();
  delete process.env.MONGO_DB_NAME;
});

afterAll(async () => {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }

  if (mongoServer) {
    await mongoServer.stop();
  }
});

describe('connectMongo', () => {
  it('uses the database name embedded in MONGO_URI', async () => {
    process.env.MONGO_URI = mongoServer.getUri('uri-only-db');
    delete process.env.MONGO_DB_NAME;

    const { connectMongo } = await import('../../src/db/connectMongo.js');
    await connectMongo();

    expect(mongoose.connection.readyState).toBe(1);
    expect(mongoose.connection.name).toBe('uri-only-db');
  });
});
