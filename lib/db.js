// PostgreSQL connection pool (server-side only).
// Credentials come from DATABASE_URL in .env - never hard-coded.
import pg from 'pg';

const { Pool, types } = pg;

// NUMERIC and BIGINT arrive as strings by default; money values here are small enough for JS numbers
types.setTypeParser(1700, (v) => (v === null ? null : parseFloat(v))); // numeric
types.setTypeParser(20, (v) => (v === null ? null : parseInt(v, 10))); // int8 / bigint

function createPool() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set. Copy .env.example to .env and fill it in.');
  }
  return new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 10,
    idleTimeoutMillis: 30_000,
    options: '-c timezone=Asia/Kolkata', // dates in reports follow Indian time
  });
}

// reuse one pool across hot reloads in development
const g = globalThis;
export function getPool() {
  if (!g.__hisaabPool) g.__hisaabPool = createPool();
  return g.__hisaabPool;
}

export function query(text, params) {
  return getPool().query(text, params);
}

export async function one(text, params) {
  const { rows } = await query(text, params);
  return rows[0] ?? null;
}

export async function many(text, params) {
  const { rows } = await query(text, params);
  return rows;
}

/**
 * Run fn(client) inside BEGIN ... COMMIT. Any thrown error -> ROLLBACK.
 * Deadlocks (40P01) and serialization failures (40001) are retried automatically.
 */
export async function withTransaction(fn, { isolation = 'READ COMMITTED', retries = 3 } = {}) {
  for (let attempt = 1; ; attempt++) {
    const client = await getPool().connect();
    try {
      await client.query(`BEGIN ISOLATION LEVEL ${isolation}`);
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      const retryable = err.code === '40P01' || err.code === '40001';
      if (retryable && attempt < retries) continue;
      throw err;
    } finally {
      client.release();
    }
  }
}
