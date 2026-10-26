import { handler, HttpError, readJson, requireUser } from '@/lib/api';
import { many, one } from '@/lib/db';
import { logActivity } from '@/lib/mongo';
import { id, num, str } from '@/lib/validate';

// GET /api/customers/:id (owner) - profile, risk, statement, monthly trend
export const GET = handler(async (request, { params }) => {
  const s = await requireUser(request, ['owner']);
  const customerId = id((await params).id, 'Customer');

  const customer = await one('SELECT r.*, c.address, c.created_at FROM v_customer_risk r JOIN customers c USING (customer_id) WHERE r.customer_id = $1 AND r.shop_id = $2', [customerId, s.shopId]);
  if (!customer) throw new HttpError(404, 'Customer not found.');

  const [ledger, trend, invoices] = await Promise.all([
    many(
      `SELECT l.entry_id, l.created_at, l.kind, l.amount, l.balance_after, l.note, l.invoice_id, l.payment_id, p.mode AS payment_mode
         FROM ledger_entries l LEFT JOIN payments p ON p.payment_id = l.payment_id
        WHERE l.customer_id = $1
        ORDER BY l.created_at DESC, l.entry_id DESC
        LIMIT 200`,
      [customerId]
    ),
    many('SELECT * FROM v_customer_monthly_trend WHERE customer_id = $1 ORDER BY month', [customerId]),
    many(
      `SELECT invoice_id, created_at, payment_mode, total FROM invoices
        WHERE customer_id = $1 ORDER BY created_at DESC LIMIT 20`,
      [customerId]
    ),
  ]);
  return { customer, ledger, trend, invoices };
});

// PATCH /api/customers/:id (owner) - credit limit / contact details
export const PATCH = handler(async (request, { params }) => {
  const s = await requireUser(request, ['owner']);
  const customerId = id((await params).id, 'Customer');
  const b = await readJson(request);
  const updated = await one(
    `UPDATE customers
        SET credit_limit = COALESCE($3, credit_limit),
            name         = COALESCE($4, name),
            address      = COALESCE($5, address)
      WHERE customer_id = $1 AND shop_id = $2
      RETURNING customer_id, name, credit_limit, current_balance, address`,
    [
      customerId,
      s.shopId,
      num(b.creditLimit, 'Credit limit', { min: 0, max: 100000, optional: true }),
      str(b.name, 'Name', { min: 2, max: 100, optional: true }),
      str(b.address, 'Address', { max: 300, optional: true }),
    ]
  );
  if (!updated) throw new HttpError(404, 'Customer not found.');
  logActivity({ shopId: s.shopId, userId: s.uid, role: s.role, action: 'customer.update', entity: 'customer', entityId: customerId, meta: b });
  return { customer: updated };
});
