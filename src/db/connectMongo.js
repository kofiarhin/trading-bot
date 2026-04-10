import mongoose from 'mongoose';

let connectionPromise = null;

function parseDbNameFromUri(uri) {
  const normalizedUri = uri?.trim();
  if (!normalizedUri) return null;

  const withoutQuery = normalizedUri.split('?')[0];
  const slashIndex = withoutQuery.lastIndexOf('/');
  if (slashIndex === -1) return null;

  const dbName = withoutQuery.slice(slashIndex + 1).trim();
  return dbName || null;
}

function getMongoConfig() {
  const uri = process.env.MONGO_URI?.trim();
  const dbName = process.env.MONGO_DB_NAME?.trim() || parseDbNameFromUri(uri);

  if (!uri) {
    throw new Error('MONGO_URI environment variable is required');
  }

  if (!dbName) {
    throw new Error(
      'MONGO_DB_NAME environment variable is required when MONGO_URI does not include a database name',
    );
  }

  return { uri, dbName };
}

export async function connectMongo() {
  if (mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }

  const { uri, dbName } = getMongoConfig();

  if (!connectionPromise) {
    connectionPromise = mongoose
      .connect(uri, { dbName })
      .then((connection) => {
        console.log(`MongoDB connected (${dbName})`);
        return connection;
      })
      .catch((error) => {
        connectionPromise = null;
        throw error;
      });
  }

  return connectionPromise;
}

export async function disconnectMongo() {
  if (mongoose.connection.readyState === 0 && !connectionPromise) {
    return;
  }

  await mongoose.disconnect();
  connectionPromise = null;
}

export default connectMongo;
