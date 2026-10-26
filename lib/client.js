'use client';
// Browser-side helpers: fetch wrapper, formatting, small hooks.
import { useCallback, useEffect, useRef, useState } from 'react';
export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* empty body */
  }
  if (res.status === 401 && typeof window !== 'undefined') {
    window.location.href = '/login';
  }
  if (!res.ok) {
    const err = new Error(data?.error || `Request failed (${res.status})`);
    err.hint = data?.hint;
    err.code = data?.code;
    throw err;
  }
  return data;
}

/** const { data, error, loading, reload } = useApi('/api/x') */
export function useApi(path) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const load = useCallback(async () => {
    if (!path) return;
    setState((s) => ({ ...s, loading: true }));
    try {
      setState({ data: await api(path), error: null, loading: false });
    } catch (e) {
      setState({ data: null, error: e.message, loading: false });
    }
  }, [path]);
  useEffect(() => {
    load();
  }, [load]);
  return { ...state, reload: load };
}

const inrFmt = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 });
const inr0 = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
export const inr = (v, whole = false) => (v === null || v === undefined ? '-' : (whole ? inr0 : inrFmt).format(Number(v)));

export const fmtDate = (v) =>
  v ? new Date(v).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '-';
export const fmtDateTime = (v) =>
  v ? new Date(v).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '-';

export function riskBadge(band) {
  return band === 'HIGH' ? 'red' : band === 'MEDIUM' ? 'amber' : 'green';
}
export function statusBadge(status) {
  return status === 'OUT' ? 'red' : status === 'LOW' ? 'amber' : 'green';
}

/** WhatsApp click-to-chat link (no API key needed) */
export function whatsappLink(phone, text) {
  return `https://wa.me/91${phone}?text=${encodeURIComponent(text)}`;
}
