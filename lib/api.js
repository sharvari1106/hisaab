// Shared helpers for API route handlers: auth guard + uniform error handling.
import { NextResponse } from 'next/server';
import { SESSION_COOKIE, verifySessionToken } from './session.js';

export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

/** Reads the session cookie and checks the role. Returns the session payload. */
export async function requireUser(request, roles) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = await verifySessionToken(token);
  if (!session) throw new HttpError(401, 'Please log in again.');
  if (roles && !roles.includes(session.role)) {
    throw new HttpError(403, `This action is not allowed for the ${session.role} role.`);
  }
  return session;
}

// Human-friendly messages for named constraints (database-level validation)
const CONSTRAINT_MESSAGES = {
  chk_price_not_above_mrp: 'Selling price cannot be higher than MRP.',
  chk_credit_needs_customer: 'Choose a customer for a credit (udhaar) sale.',
  chk_discount_le_subtotal: 'Discount cannot be more than the bill amount.',
  chk_dates: 'Expiry date must be after the manufacturing date.',
  chk_qty_remaining: 'Remaining quantity cannot exceed received quantity.',
  uq_customer_phone_per_shop: 'A customer with this phone number already exists.',
  uq_product_per_shop: 'This product (same name and size) already exists.',
  uq_supplier_invoice: 'This supplier bill number has already been entered.',
  uq_supplier_per_shop: 'A supplier with this name already exists.',
  users_phone_key: 'This phone number is already registered.',
  uq_alias_per_product: 'Duplicate alias for this product.',
};

/** Translate a PostgreSQL error into an HTTP status + message the UI can show. */
function fromPgError(err) {
  switch (err.code) {
    case 'P0001': {
      // RAISE EXCEPTION 'CODE: message' from our triggers / functions
      const [code, ...rest] = err.message.split(':');
      return { status: 400, message: rest.join(':').trim() || err.message, code, hint: err.hint };
    }
    case '23514': // check_violation
    case '23502': // not_null_violation
      return {
        status: 400,
        message: CONSTRAINT_MESSAGES[err.constraint] || `Invalid value (${err.constraint || err.column || 'constraint'}).`,
        code: 'VALIDATION',
      };
    case '23505': // unique_violation
      return { status: 409, message: CONSTRAINT_MESSAGES[err.constraint] || 'This record already exists.', code: 'DUPLICATE' };
    case '23503': // foreign_key_violation
      return { status: 409, message: 'This record is linked to other data and cannot be changed or removed.', code: 'IN_USE' };
    case '22P02': // invalid_text_representation
    case '22003': // numeric out of range
      return { status: 400, message: 'One of the values has the wrong format.', code: 'VALIDATION' };
    case '40P01':
    case '40001':
      return { status: 409, message: 'Another counter was updating the same stock. Please try again.', code: 'CONFLICT' };
    default:
      return null;
  }
}

/** Wrap a route handler: (request, ctx) => data | NextResponse */
export function handler(fn) {
  return async (request, ctx) => {
    try {
      const result = await fn(request, ctx);
      if (result instanceof Response) return result;
      return NextResponse.json(result ?? { ok: true });
    } catch (err) {
      if (err instanceof HttpError) {
        return NextResponse.json({ error: err.message, details: err.details }, { status: err.status });
      }
      const pgErr = fromPgError(err);
      if (pgErr) {
        return NextResponse.json({ error: pgErr.message, code: pgErr.code, hint: pgErr.hint }, { status: pgErr.status });
      }
      console.error(err);
      return NextResponse.json({ error: 'Something went wrong on the server.' }, { status: 500 });
    }
  };
}

export async function readJson(request) {
  try {
    return await request.json();
  } catch {
    throw new HttpError(400, 'Request body must be JSON.');
  }
}
