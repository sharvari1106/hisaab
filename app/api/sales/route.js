import { handler, HttpError, readJson, requireUser } from '@/lib/api';
import { many, one, withTransaction } from '@/lib/db';
import { logActivity } from '@/lib/mongo';
import { id, num, oneOf } from '@/lib/validate';

// GET /api/sales?limit=20&customerId=
export const GET = handler(async (request) => {
  const s = await requireUser(request, ['owner', 'staff']);
  const p = request.nextUrl.searchParams;
  const limit = Math.min(parseInt(p.get('limit') || '20', 10) || 20, 100);
  const invoices = await many(
    `SELECT i.invoice_id, i.created_at, i.payment_mode, i.subtotal, i.discount, i.total,
            u.name AS staff_name, c.name AS customer_name,
            COUNT(ii.invoice_item_id) AS lines, SUM(ii.qty) AS units
       FROM invoices i
       JOIN users u            ON u.user_id = i.staff_id
       LEFT JOIN customers c   ON c.customer_id = i.customer_id
       JOIN invoice_items ii   ON ii.invoice_id = i.invoice_id
      WHERE i.shop_id = $1 AND ($2::INT IS NULL OR i.customer_id = $2)
      GROUP BY i.invoice_id, u.name, c.name
      ORDER BY i.created_at DESC
      LIMIT $3`,
    [s.shopId, p.get('customerId') ? id(p.get('customerId')) : null, limit]
  );
  return { invoices };
});

// POST /api/sales  { customerId?, mode, discount?, items: [{productId, qty}] }
export const POST = handler(async (request) => {
  const s = await requireUser(request, ['owner', 'staff']);
  const b = await readJson(request);

  const mode = oneOf(b.mode, 'Payment mode', ['cash', 'upi', 'credit']);
  const customerId = b.customerId ? id(b.customerId, 'Customer') : null;
  if (mode === 'credit' && !customerId) throw new HttpError(400, 'Choose a customer for a credit (udhaar) sale.');
  const discount = num(b.discount || 0, 'Discount', { min: 0, max: 1_000_000 });
  if (!Array.isArray(b.items) || !b.items.length) throw new HttpError(400, 'The cart is empty.');
  if (b.items.length > 60) throw new HttpError(400, 'Too many lines in one bill.');
  const items = b.items.map((it) => ({
    product_id: id(it.productId, 'Product'),
    qty: num(it.qty, 'Quantity', { min: 1, max: 1000, integer: true }),
  }));

  // fn_process_sale does stock locking, FEFO picking, ledger + credit-limit checks atomically.
  const invoiceId = await withTransaction(async (c) => {
    const { rows } = await c.query('SELECT fn_process_sale($1, $2, $3, $4, $5::jsonb, $6) AS invoice_id', [
      s.shopId, s.uid, customerId, mode, JSON.stringify(items), discount,
    ]);
    return rows[0].invoice_id;
  });

  const invoice = await one(
    `SELECT i.invoice_id, i.total, i.payment_mode, i.created_at, c.name AS customer_name, c.current_balance
       FROM invoices i LEFT JOIN customers c ON c.customer_id = i.customer_id
      WHERE i.invoice_id = $1`,
    [invoiceId]
  );

  logActivity({
    shopId: s.shopId, userId: s.uid, role: s.role, action: 'sale.create', entity: 'invoice', entityId: invoiceId,
    meta: { total: invoice.total, mode, lines: items.length, units: items.reduce((a, i) => a + i.qty, 0), customerId },
  });
  return { invoice };
});
