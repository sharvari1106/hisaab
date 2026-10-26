'use client';
import { useState } from 'react';
import { api, fmtDate, inr, useApi } from '@/lib/client';

const blank = { shopName: '', address: '', gstin: '', ownerName: '', ownerPhone: '', ownerPassword: '' };

export default function AdminPage() {
  const list = useApi('/api/admin/shops');
  const [form, setForm] = useState(blank);
  const [msg, setMsg] = useState(null);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function create(e) {
    e.preventDefault();
    try {
      const r = await api('/api/admin/shops', { method: 'POST', body: form });
      setMsg({ ok: true, text: `Onboarded ${r.shop.name}. The owner can log in now.` });
      setForm(blank);
      list.reload();
    } catch (err) {
      setMsg({ ok: false, text: err.message });
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Shops on Hisaab</h1>
          <p>Platform admin: onboard shops. Each shop&apos;s data is isolated by shop_id in every query.</p>
        </div>
      </div>
      {msg && <div className={`alert ${msg.ok ? 'ok' : 'error'}`}>{msg.text}</div>}
      <div className="card" style={{ marginBottom: 16 }}>
        <table>
          <thead>
            <tr>
              <th>Shop</th>
              <th>Owner</th>
              <th className="num">Products</th>
              <th className="num">Customers</th>
              <th className="num">Staff</th>
              <th className="num">Bills (30d)</th>
              <th className="num">Revenue (30d)</th>
              <th>Joined</th>
            </tr>
          </thead>
          <tbody>
            {list.data?.shops.map((s) => (
              <tr key={s.shop_id}>
                <td>
                  <b>{s.name}</b>
                  <div className="small muted">{s.address}</div>
                </td>
                <td>
                  {s.owner_name}
                  <div className="small muted">{s.owner_phone}</div>
                </td>
                <td className="num">{s.products}</td>
                <td className="num">{s.customers}</td>
                <td className="num">{s.staff}</td>
                <td className="num">{s.bills_30d}</td>
                <td className="num">{inr(s.revenue_30d, true)}</td>
                <td>{fmtDate(s.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <form className="card" onSubmit={create}>
        <h2>Onboard a new shop</h2>
        <div className="form-grid">
          <label>
            Shop name
            <input value={form.shopName} onChange={set('shopName')} required />
          </label>
          <label>
            GSTIN (optional)
            <input value={form.gstin} onChange={set('gstin')} placeholder="29ABCDE1234F1Z5" />
          </label>
          <label className="wide">
            Address
            <input value={form.address} onChange={set('address')} />
          </label>
          <label>
            Owner name
            <input value={form.ownerName} onChange={set('ownerName')} required />
          </label>
          <label>
            Owner mobile
            <input value={form.ownerPhone} onChange={set('ownerPhone')} required inputMode="numeric" />
          </label>
          <label>
            Owner password
            <input type="password" value={form.ownerPassword} onChange={set('ownerPassword')} required minLength={6} />
          </label>
        </div>
        <div className="row" style={{ marginTop: 10, justifyContent: 'flex-end' }}>
          <span className="small muted">Shop + owner account are created in one transaction.</span>
          <button className="green">Create shop</button>
        </div>
      </form>
    </>
  );
}
