import { handler, HttpError, requireUser } from '@/lib/api';
import { many, one } from '@/lib/db';
import { id } from '@/lib/validate';

// GET /api/sales/:id  - owner/staff of the shop, or the customer the bill belongs to
export const GET = handler(async (request, { params }) => {
  const s = await requireUser(request, ['owner', 'staff', 'customer']);
  const invoiceId = id((await params).id, 'Invoice');

  const invoice = await one(
    `SELECT i.*, u.name AS staff_name, c.name AS customer_name, c.phone AS customer_phone,
            sh.name AS shop_name, sh.address AS shop_address, sh.gstin
       FROM invoices i
       JOIN users u   ON u.user_id = i.staff_id
       JOIN shops sh  ON sh.shop_id = i.shop_id
       LEFT JOIN customers c ON c.customer_id = i.customer_id
      WHERE i.invoice_id = $1`,
    [invoiceId]
  );
  const allowed =
    invoice &&
    (s.role === 'customer' ? invoice.customer_id === s.customerId : invoice.shop_id === s.shopId);
  if (!allowed) throw new HttpError(404, 'Bill not found.');

  // one line per product (a product may have been picked from several batches)
  const items = await many(
    `SELECT p.name, p.size_label, ii.unit_price, SUM(ii.qty) AS qty, SUM(ii.line_total) AS line_total,
            string_agg(COALESCE(b.batch_no, '#' || b.batch_id), ', ') AS batches
       FROM invoice_items ii
       JOIN products p ON p.product_id = ii.product_id
       JOIN batches b  ON b.batch_id = ii.batch_id
      WHERE ii.invoice_id = $1
      GROUP BY p.name, p.size_label, ii.unit_price
      ORDER BY p.name`,
    [invoiceId]
  );
  return { invoice, items };
});
