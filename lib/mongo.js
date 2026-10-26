// MongoDB: activity logs, flexible product attributes and scanned supplier bills.
// The app keeps working if MongoDB is down - logging just becomes a no-op.
import { MongoClient } from 'mongodb';

const g = globalThis;

export async function ensureIndexes(db) {
  const logs = db.collection('activity_logs');
  await logs.createIndex({ shopId: 1, at: -1 });
  await logs.createIndex({ shopId: 1, action: 1, at: -1 });
  // TTL index: MongoDB deletes log documents automatically after 1 year
  await logs.createIndex({ at: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 365, name: 'ttl_1y' });

  const attrs = db.collection('product_attributes');
  await attrs.createIndex({ productId: 1 }, { unique: true });
  // wildcard index: any attribute key can be queried efficiently (attributes.veg, attributes.flavour, ...)
  await attrs.createIndex({ 'attributes.$**': 1 });

  const scans = db.collection('bill_scans');
  await scans.createIndex({ shopId: 1, createdAt: -1 });
}

export async function getMongo() {
  if (!process.env.MONGODB_URI) return null;
  // after a failed connect, don't make every request wait for the timeout again for 30 s
  if (g.__hisaabMongoDownUntil && Date.now() < g.__hisaabMongoDownUntil) return null;
  try {
    if (!g.__hisaabMongo) {
      g.__hisaabMongo = MongoClient.connect(process.env.MONGODB_URI, {
        serverSelectionTimeoutMS: 2500,
      }).then(async (client) => {
        await ensureIndexes(client.db(process.env.MONGODB_DB || 'hisaab'));
        return client;
      });
    }
    const client = await g.__hisaabMongo;
    return client.db(process.env.MONGODB_DB || 'hisaab');
  } catch (e) {
    g.__hisaabMongo = null;
    g.__hisaabMongoDownUntil = Date.now() + 30_000;
    console.warn('[mongo] unavailable, retrying in 30s:', e.message);
    return null;
  }
}

/** Fire-and-forget audit log. Never breaks the request that called it. */
export async function logActivity({ shopId, userId, role, action, entity, entityId, meta = {}, at }) {
  try {
    const db = await getMongo();
    if (!db) return;
    await db.collection('activity_logs').insertOne({
      shopId,
      userId,
      role,
      action,
      entity,
      entityId,
      meta,
      at: at ? new Date(at) : new Date(),
    });
  } catch (e) {
    console.warn('[mongo] log failed:', e.message);
  }
}
