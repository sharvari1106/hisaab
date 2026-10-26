'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api, fmtDate, inr, riskBadge, useApi } from '@/lib/client';

const blank = { name: '', phone: '', address: '', creditLimit: '2000', portalPassword: '' };

export default function CustomersPage() {
  const router = useRouter();
  const [q, setQ] = useState('');
  const list = useApi(`/api/customers${q ? `?q=${encodeURIComponent(q)}` : ''}`);
  const [form, setForm] = useState(blank);
  const [show, setShow] = useState(false);
  const [msg, setMsg] = useState(null);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function create(e) {
    e.preventDefault();
    try {
      const r = await api('/api/customers', { method: 'POST', body: form });
      setMsg({ ok: true, text: `Opened a khata for ${r.customer.name}.` });
      setForm(blank);
      setShow(false);
      list.reload();
    } catch (err) {
      setMsg({ ok: false, text: err.message });
    }
  }

  const customers = list.data?.customers || [];
  const outstanding = customers.reduce((a, c) => a + Number(c.current_balance), 0);
  const high = customers.filter((c) => c.risk_band === 'HIGH').length;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Udhaar khata</h1>
          <p>
            {inr(outstanding, true)} outstanding across {customers.filter((c) => c.current_balance > 0).length} customers · {high} high-risk
          </p>
        </div>
        <button className="accent" onClick={() => setShow((s) => !s)}>
          {show ? 'Close' : '+ New customer'}
        </button>
      </div>
      {msg && <div className={`alert ${msg.ok ? 'ok' : 'error'}`}>{msg.text}</div>}

      {show && (
        <form className="card" onSubmit={create} style={{ marginBottom: 16 }}>
          <div className="form-grid">
            <label>
              Name
              <input value={form.name} onChange={set('name')} required />
            </label>
            <label>
              Mobile
              <input value={form.phone} onChange={set('phone')} required inputMode="numeric" />
            </label>
            <label>
              Credit limit (₹)
              <input value={form.creditLimit} onChange={set('creditLimit')} inputMode="decimal" />
            </label>
            <label>
              Portal password (optional)
              <input value={form.portalPassword} onChange={set('portalPassword')} placeholder="lets them log in to see dues" />
            </label>
            <label className="wide">
              Address
              <input value={form.address} onChange={set('address')} />
            </label>
          </div>
          <div className="row" style={{ marginTop: 10, justifyContent: 'flex-end' }}>
            <button className="green">Open khata</button>
          </div>
        </form>
      )}

      <div className="card">
        <input placeholder="Search name or phone" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 300, marginBottom: 10 }} />
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Customer</th>
                <th style={{ width: 220 }}>Owes / limit</th>
                <th className="num">Borrowed 90d</th>
                <th className="num">Repaid 90d</th>
                <th className="num">Avg days to repay</th>
                <th>Last payment</th>
                <th>Risk</th>
              </tr>
            </thead>
            <tbody>
              {customers.map((c) => {
                const pct = (100 * c.current_balance) / Math.max(1, c.credit_limit);
                return (
                  <tr key={c.customer_id} className="clickable" onClick={() => router.push(`/customers/${c.customer_id}`)}>
                    <td>
                      <b>{c.name}</b>
                      <div className="small muted">
                        {c.phone} {c.has_login && <span className="badge blue">portal</span>}
                      </div>
                    </td>
                    <td>
                      <div className="small">
                        <b>{inr(c.current_balance, true)}</b> <span className="muted">/ {inr(c.credit_limit, true)}</span>
                      </div>
                      <div className={`meter ${pct > 90 ? 'bad' : pct > 60 ? 'warn' : ''}`}>
                        <i style={{ width: `${Math.min(pct, 100)}%` }} />
                      </div>
                    </td>
                    <td className="num">{inr(c.borrowed_90d, true)}</td>
                    <td className="num">{inr(c.repaid_90d, true)}</td>
                    <td className="num">{c.avg_days_to_repay ?? '-'}</td>
                    <td>
                      {fmtDate(c.last_payment_at)}
                      <div className="small muted">{c.days_since_payment}d ago</div>
                    </td>
                    <td>
                      <span className={`badge ${riskBadge(c.risk_band)}`}>
                        {c.risk_band} · {c.risk_score}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="small muted" style={{ marginTop: 10 }}>
          Risk score (0-100) is computed in SQL (view v_customer_risk): 40% credit used, 30% days since last payment, 30% share of
          the last 90 days&apos; borrowing still unpaid.
        </p>
      </div>
    </>
  );
}
