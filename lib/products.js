// Helpers shared by product routes and the embed script.
import { embed, productEmbeddingText, toPgVector } from './embeddings.js';

/**
 * Recompute embeddings for the given products (or all products of a shop).
 * `db` is anything with a .query() method (pool or client).
 * Returns how many products were embedded (0 if the model is unavailable).
 */
export async function reembedProducts(db, { shopId, productIds } = {}) {
  const { rows } = await db.query(
    `SELECT p.product_id, p.name, p.brand, p.size_label, c.name AS category,
            COALESCE(array_agg(a.alias ORDER BY a.alias) FILTER (WHERE a.alias IS NOT NULL), '{}') AS aliases
       FROM products p
       LEFT JOIN categories c ON c.category_id = p.category_id
       LEFT JOIN product_aliases a ON a.product_id = p.product_id
      WHERE ($1::INT IS NULL OR p.shop_id = $1)
        AND ($2::INT[] IS NULL OR p.product_id = ANY($2))
      GROUP BY p.product_id, c.name
      ORDER BY p.product_id`,
    [shopId ?? null, productIds ?? null]
  );
  let done = 0;
  const BATCH = 16;
  for (let i = 0; i < rows.length; i += BATCH) {
    const slice = rows.slice(i, i + BATCH);
    const vectors = await embed(slice.map(productEmbeddingText));
    if (!vectors) return done;
    for (let j = 0; j < slice.length; j++) {
      await db.query('UPDATE products SET embedding = $1::vector WHERE product_id = $2', [
        toPgVector(vectors[j]),
        slice[j].product_id,
      ]);
      done++;
    }
  }
  return done;
}

/** "doodh(hi), paal(ta), milk packet" -> [{alias, language}] */
export function parseAliases(input) {
  if (!input) return [];
  const list = Array.isArray(input) ? input : String(input).split(',');
  const out = [];
  const seen = new Set();
  for (const raw of list) {
    const item = typeof raw === 'string' ? raw.trim() : raw;
    if (!item) continue;
    let alias;
    let language = 'en';
    if (typeof item === 'object') {
      alias = String(item.alias || '').trim();
      language = item.language || 'en';
    } else {
      const m = item.match(/^(.*?)\s*\((en|hi|ta|kn|te|other)\)$/i);
      alias = (m ? m[1] : item).trim();
      if (m) language = m[2].toLowerCase();
    }
    if (alias.length < 2 || alias.length > 80 || seen.has(alias.toLowerCase())) continue;
    seen.add(alias.toLowerCase());
    out.push({ alias, language });
  }
  return out.slice(0, 15);
}
