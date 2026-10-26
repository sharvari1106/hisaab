import { handler, readJson, requireUser } from '@/lib/api';
import { one, withTransaction } from '@/lib/db';
import { logActivity } from '@/lib/mongo';
import { id, num, oneOf, str } from '@/lib/validate';

// POST /api/customers/:id/payments  { amount, mode: cash|upi, note? }
export const POST = handler(async (request, { params }) => {
  const s = await requireUser(request, ['owner', 'staff']);
  const customerId = id((await params).id, 'Customer');
  const b = await readJson(request);
  const amount = num(b.amount, 'Amount', { min: 1, max: 1_000_000 });
  const mode = oneOf(b.mode, 'Mode', ['cash', 'upi']);
  const note = str(b.note, 'Note', { max: 200, optional: true });

  // stored procedure: inserts payment + ledger credit; trigger blocks over-payment
  const paymentId = await withTransaction(async (c) => {
    const { rows } = await c.query('CALL sp_record_payment($1, $2, $3, $4, $5, $6, now(), NULL)', [
      s.shopId, customerId, amount, mode, s.uid, note,
    ]);
    return rows[0].p_payment_id;
  });

  const customer = await one('SELECT customer_id, name, current_balance, credit_limit FROM customers WHERE customer_id = $1', [customerId]);
  logActivity({ shopId: s.shopId, userId: s.uid, role: s.role, action: 'payment.record', entity: 'payment', entityId: paymentId, meta: { amount, mode, customerId } });
  return { paymentId, customer };
});
