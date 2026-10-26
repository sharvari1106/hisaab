import bcrypt from 'bcryptjs';
import { handler, HttpError, readJson, requireUser } from '@/lib/api';
import { one } from '@/lib/db';
import { logActivity } from '@/lib/mongo';
import { id, str } from '@/lib/validate';

// PATCH /api/staff/:id (owner) - activate / deactivate / reset password of a STAFF account
export const PATCH = handler(async (request, { params }) => {
  const s = await requireUser(request, ['owner']);
  const userId = id((await params).id, 'User');
  const b = await readJson(request);
  const newHash = b.password ? await bcrypt.hash(str(b.password, 'Password', { min: 6, max: 100 }), 10) : null;

  const user = await one(
    `UPDATE users
        SET is_active     = COALESCE($3, is_active),
            password_hash = COALESCE($4, password_hash)
      WHERE user_id = $1 AND shop_id = $2 AND role = 'staff'
      RETURNING user_id, name, is_active`,
    [userId, s.shopId, typeof b.isActive === 'boolean' ? b.isActive : null, newHash]
  );
  if (!user) throw new HttpError(404, 'Staff member not found.');
  logActivity({ shopId: s.shopId, userId: s.uid, role: s.role, action: 'staff.update', entity: 'user', entityId: userId, meta: { isActive: b.isActive, passwordReset: Boolean(newHash) } });
  return { user };
});
