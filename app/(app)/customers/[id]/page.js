'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { api, fmtDate, fmtDateTime, inr, riskBadge, useApi, whatsappLink } from '@/lib/client';
import Receipt from '@/components/Receipt';

export default function CustomerDetail() {
  const { id } = useParams();
  const { data, error, reload } = useApi(`/api/customers/${id}`);
  const [pay, setPay] = useState({ amount: '', mode: 'cash', note: '' });
  const [limit, setLimit] = useState('');
  const [msg, setMsg] = useState(null);
  const [viewId, setViewId] = useState(null);

  if (error) return <div className="alert error">{error}</div>;
  if (!data) return <div className="empty">Loading...</div>;
  const c = data.customer;

  async function recordPayment(e) {
    e.preventDefault();
    try {
      const r = await api(`/api/customers/${id}/payments`, { method: 'POST', body: pay });
      setMsg({ ok: true, text: `Payment saved. New balance ${inr(r.customer.current_balance)}.` });
      setPay({ amount: '', mode: 'cash', note: '' });
      reload();
    } catch (err) {
      setMsg({ ok: false, text: err.message });
    }
  }

  async function saveLimit(e) {
    e.preventDefault();
    try {
      await api(`/api/customers/${id}`, { method: 'PATCH', body: { creditLimit: limit } });
      setMsg({ ok: true, text: 'Credit limit updated.' });
      setLimit('');
      reload();
    } catch (err) {
      setMsg({ ok: false, text: err.message });
    }
  }

  const maxMonth = Math.max(1, ...data.trend.map((t) => Math.max(Number(t.borrowed), Number(t.repaid))));
  const reminder = `Namaste ${c.name}, this is a reminder from our shop: your pending balance is ${inr(c.current_balance)}. You can pay by cash or UPI. Thank you!`;

  return (
    <>
      <div className="page-head">
        <div>
          <Link href="/customers" className="small muted">
            ← All customers
          </Link>
          <h1>{c.name}</h1>
          <p>
            {c.phone} · {c.address || 'no address'} · customer since {fmtDate(c.created_at)}
          </p>
        </div>
        {c.current_balance > 0 && (
          <a className="btn" style={{ background: '#1f8f4e', borderColor: '#1f8f4e' }} href={whatsappLink(c.phone, reminder)} target="_blank" rel="noreferrer">
            Send WhatsApp reminder
          </a>
        )}
      </div>
      {msg && <div className={`alert ${msg.ok ? 'ok' : 'error'}`}>{msg.text}</div>}

      <div className="grid kpis" style={{ marginBottom: 16 }}>
        <div className="card stat">
          <span className="label">Owes now</span>
          <span className="value" style={{ color: c.current_balance > 0 ? 'var(--red)' : 'var(--green)' }}>
            {inr(c.current_balance)}
          </span>
          <span className="sub">limit {inr(c.credit_limit, true)}</span>
        </div>
        <div className="card stat">
          <span className="label">Risk score</span>
          <span className="value">{c.risk_score}</span>
          <span className={`badge ${riskBadge(c.risk_band)}`} style={{ alignSelf: 'flex-start' }}>
            {c.risk_band} · rank #{c.risk_rank}
          </span>
        </div>
        <div className="card stat">
          <span className="label">Borrowed / repaid (90d)</span>
          <span className="value">{inr(c.borrowed_90d, true)}</span>
          <span className="sub">repaid {inr(c.repaid_90d, true)}</span>
        </div>
        <div className="card stat">
          <span className="label">Avg days to repay</span>
          <span className="value">{c.avg_days_to_repay ?? '-'}</span>
          <span className="sub">last paid {c.days_since_payment} days ago</span>
        </div>
      </div>

      <div className="grid two" style={{ marginBottom: 16 }}>
        <form className="card" onSubmit={recordPayment}>
          <h2>Record a payment</h2>
          <div className="form-grid">
            <label>
              Amount (₹)
              <input inputMode="decimal" value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} required />
            </label>
            <label>
              Mode
              <select value={pay.mode} onChange={(e) => setPay({ ...pay, mode: e.target.value })}>
                <option value="cash">Cash</option>
                <option value="upi">UPI</option>
              </select>
            </label>
            <label className="wide">
              Note
              <input value={pay.note} onChange={(e) => setPay({ ...pay, note: e.target.value })} placeholder="optional" />
            </label>
          </div>
          <div className="row" style={{ marginTop: 10 }}>
            <button type="button" className="small secondary" onClick={() => setPay({ ...pay, amount: String(c.current_balance) })}>
              Full amount
            </button>
            <span className="spacer" />
            <button className="green">Save payment</button>
          </div>
          <p className="small muted">Stored procedure sp_record_payment; a trigger rejects paying more than is owed.</p>
        </form>

        <div className="card">
          <h2>Monthly trend</h2>
          {data.trend.map((t) => (
            <div key={t.month} style={{ marginBottom: 8 }}>
              <div className="small">
                <b>{new Date(t.month).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}</b> · balance after month {inr(t.closing_balance, true)}
                {t.borrowed_change !== null && (
                  <span className="muted"> · borrowing {t.borrowed_change >= 0 ? '▲' : '▼'} {inr(Math.abs(t.borrowed_change), true)}</span>
                )}
              </div>
              <div className="hbar" style={{ gridTemplateColumns: '70px 1fr 70px', margin: '2px 0' }}>
                <span className="small muted">borrowed</span>
                <div className="track">
                  <i style={{ width: `${(100 * t.borrowed) / maxMonth}%`, background: 'var(--red)' }} />
                </div>
                <span className="small num">{inr(t.borrowed, true)}</span>
              </div>
              <div className="hbar" style={{ gridTemplateColumns: '70px 1fr 70px', margin: '2px 0' }}>
                <span className="small muted">repaid</span>
                <div className="track">
                  <i style={{ width: `${(100 * t.repaid) / maxMonth}%`, background: 'var(--green)' }} />
                </div>
                <span className="small num">{inr(t.repaid, true)}</span>
              </div>
            </div>
          ))}
          <form className="row" onSubmit={saveLimit} style={{ marginTop: 12 }}>
            <input placeholder={`Credit limit (now ${c.credit_limit})`} value={limit} onChange={(e) => setLimit(e.target.value)} inputMode="decimal" />
            <button className="secondary">Update limit</button>
          </form>
        </div>
      </div>

      <div className="card ledger">
        <h2>Khata statement</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Entry</th>
                <th className="num">Udhaar (+)</th>
                <th className="num">Paid (−)</th>
                <th className="num">Balance</th>
              </tr>
            </thead>
            <tbody>
              {data.ledger.map((l) => (
                <tr key={l.entry_id} className={`${l.kind} ${l.invoice_id ? 'clickable' : ''}`} onClick={() => l.invoice_id && setViewId(l.invoice_id)}>
                  <td>{fmtDateTime(l.created_at)}</td>
                  <td>
                    {l.note}
                    {l.payment_mode && <span className="badge grey" style={{ marginLeft: 6 }}>{l.payment_mode}</span>}
                  </td>
                  <td className="num amt">{l.kind === 'debit' ? inr(l.amount) : ''}</td>
                  <td className="num amt">{l.kind === 'credit' ? inr(l.amount) : ''}</td>
                  <td className="num">
                    <b>{inr(l.balance_after)}</b>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!data.ledger.length && <div className="empty">No entries yet.</div>}
        </div>
        <p className="small muted">Ledger rows are append-only: a trigger blocks UPDATE and DELETE on ledger_entries.</p>
      </div>
      {viewId && <Receipt invoiceId={viewId} onClose={() => setViewId(null)} />}
    </>
  );
}
