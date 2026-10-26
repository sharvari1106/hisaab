import bcrypt from 'bcryptjs';
import { NextResponse } from 'next/server';
import { handler, HttpError, readJson } from '@/lib/api';
import { one } from '@/lib/db';
import { logActivity } from '@/lib/mongo';
import { createSessionToken, ROLE_HOME, SESSION_COOKIE, sessionCookieOptions } from '@/lib/session';
import { phone, str } from '@/lib/validate';

export const POST = handler(async (request) => {
  const body = await readJson(request);
  const ph = phone(body.phone);
  const password = str(body.password, 'Password', { min: 6, max: 100 });

  const user = await one(
    `SELECT u.user_id, u.name, u.role, u.shop_id, u.customer_id, u.password_hash, u.is_active, s.name AS shop_name
       FROM users u LEFT JOIN shops s ON s.shop_id = u.shop_id
      WHERE u.phone = $1`,
    [ph]
  );
  // same message for "no such user" and "wrong password" so attackers can't probe phone numbers
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    throw new HttpError(401, 'Wrong phone number or password.');
  }
  if (!user.is_active) throw new HttpError(403, 'This account has been deactivated by the shop owner.');

  const token = await createSessionToken({
    uid: user.user_id,
    role: user.role,
    shopId: user.shop_id,
    customerId: user.customer_id,
    name: user.name,
    shopName: user.shop_name,
  });

  logActivity({ shopId: user.shop_id, userId: user.user_id, role: user.role, action: 'auth.login' });

  const res = NextResponse.json({ ok: true, role: user.role, home: ROLE_HOME[user.role] });
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions);
  return res;
});
