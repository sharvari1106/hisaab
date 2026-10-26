// JWT session helpers. Uses only `jose`, so it is safe to import from middleware (Edge runtime).
import { SignJWT, jwtVerify } from 'jose';

export const SESSION_COOKIE = 'hisaab_session';
const MAX_AGE_SECONDS = 60 * 60 * 10; // one shop day

function secretKey() {
  const s = process.env.JWT_SECRET;
  if (!s || s.length < 32) {
    throw new Error('JWT_SECRET must be set in .env and be at least 32 characters long.');
  }
  return new TextEncoder().encode(s);
}

/** payload: { uid, role, shopId, customerId, name } */
export async function createSessionToken(payload) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_SECONDS}s`)
    .sign(secretKey());
}

export async function verifySessionToken(token) {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey());
    return payload;
  } catch {
    return null;
  }
}

export const sessionCookieOptions = {
  httpOnly: true, // JavaScript in the browser cannot read it (XSS protection)
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge: MAX_AGE_SECONDS,
};

/** Home page for each role */
export const ROLE_HOME = {
  admin: '/admin',
  owner: '/billing',
  staff: '/billing',
  customer: '/my',
};

/** Which roles may open which pages (checked in middleware). */
export const PAGE_ROLES = [
  { prefix: '/admin', roles: ['admin'] },
  { prefix: '/my', roles: ['customer'] },
  { prefix: '/billing', roles: ['owner', 'staff'] },
  { prefix: '/inventory', roles: ['owner', 'staff'] },
  { prefix: '/products', roles: ['owner'] },
  { prefix: '/customers', roles: ['owner'] },
  { prefix: '/bill-scan', roles: ['owner'] },
  { prefix: '/reports', roles: ['owner'] },
  { prefix: '/staff', roles: ['owner'] },
];
