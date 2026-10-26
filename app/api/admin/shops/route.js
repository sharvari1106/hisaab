import bcrypt from 'bcryptjs';
import { handler, readJson, requireUser } from '@/lib/api';
import { many, withTransaction } from '@/lib/db';
import { logActivity } from '@/lib/mongo';
import { phone, str } from '@/lib/validate';

// GET /api/admin/shops (admin) - every shop with usage counts (scalar subqueries)
export const GET = handler(async (request) => {
  await requireUser(request, ['admin']);
  const shops = await many(
    `SELECT s.shop_id, s.name, s.address, s.phone, s.gstin, s.created_at, o.name AS owner_name, o.phone AS owner_phone,
            (SELECT COUNT(*) FROM products p  WHERE p.shop_id = s.shop_id)  AS products,
            (SELECT COUNT(*) FROM customers c WHERE c.shop_id = s.shop_id)  AS customers,
            (SELECT COUNT(*) FROM users u     WHERE u.shop_id = s.shop_id AND u.role = 'staff') AS staff,
            (SELECT COUNT(*) FROM invoices i  WHERE i.shop_id = s.shop_id AND i.created_at >= now() - INTERVAL '30 days') AS bills_30d,
            (SELECT COALESCE(SUM(total), 0) FROM invoices i WHERE i.shop_id = s.shop_id AND i.created_at >= now() - INTERVAL '30 days') AS revenue_30d
       FROM shops s LEFT JOIN users o ON o.user_id = s.owner_id
      ORDER BY s.created_at DESC`
  );
  return { shops };
});

// POST /api/admin/shops (admin) - onboard a shop and its owner in ONE transaction
export const POST = handler(async (request) => {
  const s = await requireUser(request, ['admin']);
  const b = await readJson(request);
  const shopName = str(b.shopName, 'Shop name', { min: 2, max: 120 });
  const address = str(b.address, 'Address', { max: 300, optional: true });
  const gstin = str(b.gstin, 'GSTIN', { min: 15, max: 15, optional: true })?.toUpperCase() ?? null;
  const ownerName = str(b.ownerName, 'Owner name', { min: 2, max: 100 });
  const ownerPhone = phone(b.ownerPhone, 'Owner phone');
  const hash = await bcrypt.hash(str(b.ownerPassword, 'Owner password', { min: 6, max: 100 }), 10);

  const shop = await withTransaction(async (c) => {
    const { rows } = await c.query(
      'INSERT INTO shops (name, address, phone, gstin) VALUES ($1, $2, $3, $4) RETURNING shop_id, name',
      [shopName, address, ownerPhone, gstin]
    );
    const owner = await c.query(
      `INSERT INTO users (name, phone, password_hash, role, shop_id) VALUES ($1, $2, $3, 'owner', $4) RETURNING user_id`,
      [ownerName, ownerPhone, hash, rows[0].shop_id]
    );
    await c.query('UPDATE shops SET owner_id = $1 WHERE shop_id = $2', [owner.rows[0].user_id, rows[0].shop_id]);
    return rows[0];
  });

  logActivity({ shopId: null, userId: s.uid, role: s.role, action: 'shop.create', entity: 'shop', entityId: shop.shop_id });
  return { shop };
});
