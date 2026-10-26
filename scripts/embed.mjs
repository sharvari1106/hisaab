// Computes a 384-d embedding for every product and stores it in products.embedding (pgvector).
//   npm run db:embed
// First run downloads the multilingual MiniLM model (~120 MB) from Hugging Face; later runs use the cache.
import pg from 'pg';
import { embedOne, toPgVector } from '../lib/embeddings.js';
import { reembedProducts } from '../lib/products.js';

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set. Copy .env.example to .env first.');
  process.exit(1);
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  console.log('Embedding products (first run downloads the model, please wait)...');
  const t0 = Date.now();
  const n = await reembedProducts(client, {});
  if (!n) {
    console.log('Embedding model could not be loaded. Semantic search stays off; text + fuzzy search still work.');
  } else {
    console.log(`Embedded ${n} products in ${((Date.now() - t0) / 1000).toFixed(1)}s.\n`);
    // quick demo: pure vector search for a few local-language queries
    for (const q of ['doodh', 'thengai ennai', 'something to wash clothes', 'snack for kids']) {
      const v = await embedOne(q);
      const { rows } = await client.query(
        `SELECT name, ROUND((embedding <=> $1::vector)::NUMERIC, 3) AS distance
           FROM products WHERE embedding IS NOT NULL
          ORDER BY embedding <=> $1::vector LIMIT 3`,
        [toPgVector(v)]
      );
      console.log(`"${q}" ->`, rows.map((r) => `${r.name} (${r.distance})`).join(', '));
    }
  }
} catch (e) {
  console.error(`FAILED: ${e.message}`);
  process.exitCode = 1;
} finally {
  await client.end();
}
