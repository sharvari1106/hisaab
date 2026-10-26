// Light input checks in the API layer. The database constraints are the real guard;
// these just give quicker, friendlier errors and stop obviously bad input early.
import { HttpError } from './api.js';

export function str(v, field, { min = 1, max = 200, optional = false } = {}) {
  if (v === undefined || v === null || v === '') {
    if (optional) return null;
    throw new HttpError(400, `${field} is required.`);
  }
  const s = String(v).trim();
  if (s.length < min || s.length > max) throw new HttpError(400, `${field} must be ${min}-${max} characters.`);
  return s;
}

export function num(v, field, { min = -Infinity, max = Infinity, optional = false, integer = false } = {}) {
  if (v === undefined || v === null || v === '') {
    if (optional) return null;
    throw new HttpError(400, `${field} is required.`);
  }
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max || (integer && !Number.isInteger(n))) {
    throw new HttpError(400, `${field} must be ${integer ? 'a whole number' : 'a number'} between ${min} and ${max}.`);
  }
  return n;
}

export function phone(v, field = 'Phone', { optional = false } = {}) {
  const s = str(v, field, { min: 10, max: 13, optional });
  if (s === null) return null;
  const digits = s.replace(/\D/g, '').replace(/^91(?=\d{10}$)/, '');
  if (!/^[6-9]\d{9}$/.test(digits)) throw new HttpError(400, `${field} must be a valid 10-digit Indian mobile number.`);
  return digits;
}

export function oneOf(v, field, allowed) {
  if (!allowed.includes(v)) throw new HttpError(400, `${field} must be one of: ${allowed.join(', ')}.`);
  return v;
}

export function date(v, field, { optional = true } = {}) {
  if (!v) {
    if (optional) return null;
    throw new HttpError(400, `${field} is required.`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v))) throw new HttpError(400, `${field} must be a date (YYYY-MM-DD).`);
  return v;
}

export function id(v, field = 'id') {
  return num(v, field, { min: 1, max: 2147483647, integer: true });
}
