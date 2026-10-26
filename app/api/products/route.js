import { handler, readJson, requireUser } from '@/lib/api';
import { getPool, many, withTransaction } from '@/lib/db';
import { getMongo, logActivity } from '@/lib/mongo';
import { parseAliases, reembedProducts } from '@/lib/products';
import { id, num, oneOf, str } from '@/lib/validate';

// GET /api/products?q=&status=LOW|OUT|OK&category=
export const GET = handler(async (request) => {
  const s = await requireUser(request, ['owner', 'staff']);
  const p = request.nextUrl.searchParams;
  const rows = await many(
    `SELECT ps.*,
            COALESCE((SELECT string_agg(a.alias || '(' || a.language || ')', ', ' ORDER BY a.alias)
                        FROM product_aliases a WHERE a.product_id = ps.product_id), '') AS aliases,
            (SELECT p.embedding IS NOT NULL FROM products p WHERE p.product_id = ps.product_id) AS has_embedding
       FROM v_product_stock ps
      WHERE ps.shop_id = $1
        AND ($2::TEXT IS NULL OR ps.name ILIKE '%' || $2 || '%' OR ps.brand ILIKE '%' || $2 || '%')
        AND ($3::TEXT IS NULL OR ps.status = $3)
        AND ($4::TEXT IS NULL OR ps.category = $4)
      ORDER BY ps.category NULLS LAST, ps.name`,
    [s.shopId, p.get('q') || null, p.get('status') || null, p.get('category') || null]
  );

  // flexible attributes live in MongoDB
  const db = await getMongo();
  if (db && rows.length) {
    const docs = await db
      .collection('product_attributes')
      .find({ productId: { $in: rows.map((r) => r.product_id) } }, { projection: { _id: 0, productId: 1, attributes: 1 } })
      .toArray();
    const byId = new Map(docs.map((d) => [d.productId, d.attributes]));
    rows.forEach((r) => (r.attributes = byId.get(r.product_id) || null));
  }
  return { products: rows };
});

// POST /api/products  (owner) - create a product with aliases, attributes and embedding
export const POST = handler(async (request) => {
  const s = await requireUser(request, ['owner']);
  const b = await readJson(request);
  const product = {
    name: str(b.name, 'Name', { min: 2, max: 150 }),
    brand: str(b.brand, 'Brand', { max: 80, optional: true }),
    size_label: str(b.sizeLabel, 'Size', { max: 30, optional: true }),
    unit: oneOf(b.unit || 'pcs', 'Unit', ['pcs', 'pack', 'kg', 'g', 'l', 'ml', 'dozen']),
    category_id: b.categoryId ? id(b.categoryId, 'Category') : null,
    mrp: num(b.mrp, 'MRP', { min: 0.01, max: 100000 }),
    selling_price: num(b.sellingPrice, 'Selling price', { min: 0.01, max: 100000 }),
    reorder_level: num(b.reorderLevel ?? 5, 'Reorder level', { min: 0, max: 10000, integer: true }),
  };
  const aliases = parseAliases(b.aliases);

  const created = await withTransaction(async (c) => {
    const { rows } = await c.query(
      `INSERT INTO products (shop_id, name, brand, size_label, unit, category_id, mrp, selling_price, reorder_level)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING product_id, name`,
      [s.shopId, product.name, product.brand, product.size_label, product.unit, product.category_id,
       product.mrp, product.selling_price, product.reorder_level]
    );
    for (const a of aliases) {
      await c.query('INSERT INTO product_aliases (product_id, alias, language) VALUES ($1, $2, $3)', [
        rows[0].product_id, a.alias, a.language,
      ]);
    }
    return rows[0];
  });

  // attributes: free-form key/value pairs that differ per product type -> MongoDB document
  const attributes = parseAttributes(b.attributes);
  const db = await getMongo();
  if (db && Object.keys(attributes).length) {
    await db.collection('product_attributes').updateOne(
      { productId: created.product_id },
      { $set: { shopId: s.shopId, attributes, updatedAt: new Date() } },
      { upsert: true }
    );
  }

  const embedded = await reembedProducts(getPool(), { productIds: [created.product_id] });
  logActivity({ shopId: s.shopId, userId: s.uid, role: s.role, action: 'product.create', entity: 'product', entityId: created.product_id, meta: { name: created.name } });
  return { product: created, embedded: embedded > 0 };
});

/** "veg=true\nweight_g=500\nflavour=masala" or an object -> {veg:true, weight_g:500, flavour:'masala'} */
function parseAttributes(input) {
  if (!input) return {};
  const entries = typeof input === 'object'
    ? Object.entries(input)
    : String(input).split(/\n|;/).map((line) => line.split('=').map((x) => x.trim())).filter((kv) => kv.length === 2 && kv[0]);
  const out = {};
  for (const [k, v] of entries.slice(0, 20)) {
    const key = String(k).toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 40);
    if (!key || key.startsWith('$')) continue;
    if (v === 'true' || v === 'false') out[key] = v === 'true';
    else if (v !== '' && !Number.isNaN(Number(v))) out[key] = Number(v);
    else out[key] = String(v).slice(0, 100);
  }
  return out;
}
