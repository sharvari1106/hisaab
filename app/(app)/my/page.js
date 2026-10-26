'use client';
import { useState } from 'react';
import { fmtDateTime, inr, useApi } from '@/lib/client';

export default function MyAccount() {
  const { data, error } = useApi('/api/me');
  const [open, setOpen] = useState(null);
  if (error) return <div className="alert error">{error}</div>;
  if (!data) return <div className="empty">Loading...</div>;
  const a = data.account;
  const pct = (100 * a.current_balance) / Math.max(1, a.credit_limit);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Namaste, {a.name}</h1>
          <p>
            Your khata at <b>{a.shop_name}</b> · {a.shop_address} · {a.shop_phone}
          </p>
        </div>
      </div>

      <div className="grid kpis" style={{ marginBottom: 16 }}>
        <div className="card stat">
          <span className="label">You owe</span>
          <span className="value" style={{ color: a.current_balance > 0 ? 'var(--red)' : 'var(--green)' }}>
            {inr(a.current_balance)}
          </span>
          <div className={`meter ${pct > 90 ? 'bad' : pct > 60 ? 'warn' : ''}`}>
            <i style={{ width: `${Math.min(100, pct)}%` }} />
          </div>
        </div>
        <div className="card stat">
          <span className="label">Credit limit</span>
          <span className="value">{inr(a.credit_limit, true)}</span>
          <span className="sub">{inr(a.available_credit, true)} still available</span>
        </div>
      </div>

      <div className="grid two">
        <div className="card ledger">
          <h2>Statement</h2>
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Entry</th>
                <th className="num">Amount</th>
                <th className="num">Balance</th>
              </tr>
            </thead>
            <tbody>
              {data.ledger.map((l, i) => (
                <tr key={i} className={l.kind}>
                  <td>{fmtDateTime(l.created_at)}</td>
                  <td>{l.note}</td>
                  <td className="num amt">
                    {l.kind === 'debit' ? '+' : '−'}
                    {inr(l.amount)}
                  </td>
                  <td className="num">{inr(l.balance_after)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!data.ledger.length && <div className="empty">No udhaar yet.</div>}
        </div>
        <div className="card">
          <h2>My bills</h2>
          {data.invoices.map((inv) => (
            <div key={inv.invoice_id} style={{ borderBottom: '1px solid var(--line)', padding: '8px 0' }}>
              <div className="row" style={{ cursor: 'pointer' }} onClick={() => setOpen(open === inv.invoice_id ? null : inv.invoice_id)}>
                <span className="mono">#{inv.invoice_id}</span>
                <span className="muted small">{fmtDateTime(inv.created_at)}</span>
                <span className={`badge ${inv.payment_mode === 'credit' ? 'red' : 'green'}`}>{inv.payment_mode === 'credit' ? 'udhaar' : inv.payment_mode}</span>
                <span className="spacer" />
                <b>{inr(inv.total)}</b>
              </div>
              {open === inv.invoice_id && (
                <table style={{ marginTop: 6 }}>
                  <tbody>
                    {inv.items.map((it, i) => (
                      <tr key={i}>
                        <td className="small">
                          {it.name} {it.size}
                        </td>
                        <td className="small num">
                          {it.qty} × {inr(it.price)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
