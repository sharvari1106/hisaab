// Customer portal: a customer sees ONLY their own account (customer_id comes from the signed session)
import { handler, requireUser } from '@/lib/api';
import { many, one } from '@/lib/db';

export const GET = handler(async (request) => {
  const s = await requireUser(request, ['customer']);
  const [account, ledger, invoices] = await Promise.all([
    one(
      `SELECT c.name, c.phone, c.credit_limit, c.current_balance, (c.credit_limit - c.current_balance) AS available_credit,
              sh.name AS shop_name, sh.phone AS shop_phone, sh.address AS shop_address
         FROM customers c JOIN shops sh ON sh.shop_id = c.shop_id
        WHERE c.customer_id = $1`,
      [s.customerId]
    ),
    many(
      `SELECT created_at, kind, amount, balance_after, note, invoice_id
         FROM ledger_entries WHERE customer_id = $1
        ORDER BY created_at DESC, entry_id DESC LIMIT 100`,
      [s.customerId]
    ),
    // json_agg nests each bill's items inside the bill row
    many(
      `SELECT i.invoice_id, i.created_at, i.payment_mode, i.total,
              json_agg(json_build_object('name', p.name, 'size', p.size_label, 'qty', ii.qty, 'price', ii.unit_price)
                       ORDER BY p.name) AS items
         FROM invoices i
         JOIN invoice_items ii ON ii.invoice_id = i.invoice_id
         JOIN products p ON p.product_id = ii.product_id
        WHERE i.customer_id = $1
        GROUP BY i.invoice_id
        ORDER BY i.created_at DESC
        LIMIT 30`,
      [s.customerId]
    ),
  ]);
  return { account, ledger, invoices };
});
