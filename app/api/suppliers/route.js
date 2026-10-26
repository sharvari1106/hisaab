import { handler, readJson, requireUser } from '@/lib/api';
import { many, one } from '@/lib/db';
import { phone, str } from '@/lib/validate';

export const GET = handler(async (request) => {
  const s = await requireUser(request, ['owner', 'staff']);
  const suppliers = await many(
    `SELECT su.supplier_id, su.name, su.phone,
            COUNT(pu.purchase_id) AS bills, COALESCE(SUM(pu.total_amount), 0) AS total_bought,
            MAX(pu.purchase_date) AS last_purchase
       FROM suppliers su LEFT JOIN purchases pu ON pu.supplier_id = su.supplier_id
      WHERE su.shop_id = $1
      GROUP BY su.supplier_id
      ORDER BY su.name`,
    [s.shopId]
  );
  return { suppliers };
});

export const POST = handler(async (request) => {
  const s = await requireUser(request, ['owner']);
  const b = await readJson(request);
  const supplier = await one(
    'INSERT INTO suppliers (shop_id, name, phone) VALUES ($1, $2, $3) RETURNING supplier_id, name, phone',
    [s.shopId, str(b.name, 'Supplier name', { min: 2, max: 120 }), phone(b.phone, 'Phone', { optional: true })]
  );
  return { supplier };
});
