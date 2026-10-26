import bcrypt from 'bcryptjs';
import { handler, readJson, requireUser } from '@/lib/api';
import { many, withTransaction } from '@/lib/db';
import { logActivity } from '@/lib/mongo';
import { num, phone, str } from '@/lib/validate';

// GET /api/customers?q=   (owner: full risk view, staff: name/balance for billing)
export const GET = handler(async (request) => {
  const s = await requireUser(request, ['owner', 'staff']);
  const q = (request.nextUrl.searchParams.get('q') || '').trim() || null;
  const customers = await many(
    `SELECT r.customer_id, r.name, r.phone, r.credit_limit, r.current_balance,
            (r.credit_limit - r.current_balance) AS available_credit,
            r.risk_score, r.risk_band, r.risk_rank, r.days_since_payment, r.last_payment_at,
            r.borrowed_90d, r.repaid_90d, r.avg_days_to_repay,
            EXISTS (SELECT 1 FROM users u WHERE u.customer_id = r.customer_id) AS has_login
       FROM v_customer_risk r
      WHERE r.shop_id = $1
        AND ($2::TEXT IS NULL OR r.name ILIKE '%' || $2 || '%' OR r.phone LIKE $2 || '%')
      ORDER BY r.current_balance DESC, r.name`,
    [s.shopId, q]
  );
  if (s.role === 'staff') {
    // staff only need what the counter needs
    return { customers: customers.map(({ customer_id, name, phone: ph, credit_limit, current_balance, available_credit }) => ({ customer_id, name, phone: ph, credit_limit, current_balance, available_credit })) };
  }
  return { customers };
});

// POST /api/customers (owner) - optional portal login is created in the same transaction
export const POST = handler(async (request) => {
  const s = await requireUser(request, ['owner']);
  const b = await readJson(request);
  const name = str(b.name, 'Name', { min: 2, max: 100 });
  const ph = phone(b.phone);
  const address = str(b.address, 'Address', { max: 300, optional: true });
  const creditLimit = num(b.creditLimit ?? 2000, 'Credit limit', { min: 0, max: 100000 });
  const portalPassword = b.portalPassword ? str(b.portalPassword, 'Portal password', { min: 6, max: 100 }) : null;

  const customer = await withTransaction(async (c) => {
    const { rows } = await c.query(
      `INSERT INTO customers (shop_id, name, phone, address, credit_limit)
       VALUES ($1, $2, $3, $4, $5) RETURNING customer_id, name, phone, credit_limit`,
      [s.shopId, name, ph, address, creditLimit]
    );
    if (portalPassword) {
      await c.query(
        `INSERT INTO users (name, phone, password_hash, role, shop_id, customer_id)
         VALUES ($1, $2, $3, 'customer', $4, $5)`,
        [name, ph, await bcrypt.hash(portalPassword, 10), s.shopId, rows[0].customer_id]
      );
    }
    return rows[0];
  });

  logActivity({ shopId: s.shopId, userId: s.uid, role: s.role, action: 'customer.create', entity: 'customer', entityId: customer.customer_id });
  return { customer };
});
