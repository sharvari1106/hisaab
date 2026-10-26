import bcrypt from 'bcryptjs';
import { handler, readJson, requireUser } from '@/lib/api';
import { many, one } from '@/lib/db';
import { logActivity } from '@/lib/mongo';
import { phone, str } from '@/lib/validate';

export const GET = handler(async (request) => {
  const s = await requireUser(request, ['owner']);
  const staff = await many(
    `SELECT u.user_id, u.name, u.phone, u.role, u.is_active, u.created_at,
            (SELECT COUNT(*) FROM invoices i WHERE i.staff_id = u.user_id AND i.created_at >= current_date) AS bills_today
       FROM users u
      WHERE u.shop_id = $1 AND u.role IN ('owner', 'staff')
      ORDER BY u.role, u.name`,
    [s.shopId]
  );
  return { staff };
});

export const POST = handler(async (request) => {
  const s = await requireUser(request, ['owner']);
  const b = await readJson(request);
  const user = await one(
    `INSERT INTO users (name, phone, password_hash, role, shop_id)
     VALUES ($1, $2, $3, 'staff', $4)
     RETURNING user_id, name, phone, role, is_active`,
    [
      str(b.name, 'Name', { min: 2, max: 100 }),
      phone(b.phone),
      await bcrypt.hash(str(b.password, 'Password', { min: 6, max: 100 }), 10),
      s.shopId,
    ]
  );
  logActivity({ shopId: s.shopId, userId: s.uid, role: s.role, action: 'staff.create', entity: 'user', entityId: user.user_id });
  return { user };
});
