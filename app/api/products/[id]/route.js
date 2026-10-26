import { handler, HttpError, readJson, requireUser } from '@/lib/api';
import { getPool, withTransaction } from '@/lib/db';
import { logActivity } from '@/lib/mongo';
import { parseAliases, reembedProducts } from '@/lib/products';
import { id, num } from '@/lib/validate';

// PATCH /api/products/:id  (owner) - price, reorder level, active flag, aliases
export const PATCH = handler(async (request, { params }) => {
  const s = await requireUser(request, ['owner']);
  const productId = id((await params).id, 'Product');
  const b = await readJson(request);

  const updated = await withTransaction(async (c) => {
    const { rows } = await c.query(
      `UPDATE products
          SET mrp           = COALESCE($3, mrp),
              selling_price = COALESCE($4, selling_price),
              reorder_level = COALESCE($5, reorder_level),
              is_active     = COALESCE($6, is_active)
        WHERE product_id = $1 AND shop_id = $2
        RETURNING product_id, name, mrp, selling_price, reorder_level, is_active`,
      [
        productId,
        s.shopId,
        num(b.mrp, 'MRP', { min: 0.01, max: 100000, optional: true }),
        num(b.sellingPrice, 'Selling price', { min: 0.01, max: 100000, optional: true }),
        num(b.reorderLevel, 'Reorder level', { min: 0, max: 10000, integer: true, optional: true }),
        typeof b.isActive === 'boolean' ? b.isActive : null,
      ]
    );
    if (!rows.length) throw new HttpError(404, 'Product not found.');

    if (b.aliases !== undefined) {
      await c.query('DELETE FROM product_aliases WHERE product_id = $1', [productId]);
      for (const a of parseAliases(b.aliases)) {
        await c.query('INSERT INTO product_aliases (product_id, alias, language) VALUES ($1, $2, $3)', [productId, a.alias, a.language]);
      }
    }
    return rows[0];
  });

  if (b.aliases !== undefined) await reembedProducts(getPool(), { productIds: [productId] });
  logActivity({ shopId: s.shopId, userId: s.uid, role: s.role, action: 'product.update', entity: 'product', entityId: productId, meta: b });
  return { product: updated };
});
