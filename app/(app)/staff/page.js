'use client';
import { useState } from 'react';
import { api, fmtDate, useApi } from '@/lib/client';

export default function StaffPage() {
  const list = useApi('/api/staff');
  const [form, setForm] = useState({ name: '', phone: '', password: '' });
  const [msg, setMsg] = useState(null);

  async function create(e) {
    e.preventDefault();
    try {
      await api('/api/staff', { method: 'POST', body: form });
      setMsg({ ok: true, text: `${form.name} can now log in with their mobile number.` });
      setForm({ name: '', phone: '', password: '' });
      list.reload();
    } catch (err) {
      setMsg({ ok: false, text: err.message });
    }
  }

  async function update(id, body, text) {
    try {
      await api(`/api/staff/${id}`, { method: 'PATCH', body });
      setMsg({ ok: true, text });
      list.reload();
    } catch (err) {
      setMsg({ ok: false, text: err.message });
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Staff</h1>
          <p>Staff can bill and receive stock. They cannot see profit, edit prices or change credit limits.</p>
        </div>
      </div>
      {msg && <div className={`alert ${msg.ok ? 'ok' : 'error'}`}>{msg.text}</div>}
      <div className="grid two">
        <div className="card">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Mobile</th>
                <th>Role</th>
                <th className="num">Bills today</th>
                <th>Since</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.data?.staff.map((u) => (
                <tr key={u.user_id}>
                  <td>
                    <b>{u.name}</b> {!u.is_active && <span className="badge red">disabled</span>}
                  </td>
                  <td>{u.phone}</td>
                  <td>
                    <span className="badge grey">{u.role}</span>
                  </td>
                  <td className="num">{u.bills_today}</td>
                  <td>{fmtDate(u.created_at)}</td>
                  <td className="num">
                    {u.role === 'staff' && (
                      <div className="row" style={{ justifyContent: 'flex-end' }}>
                        <button className="small secondary" onClick={() => update(u.user_id, { isActive: !u.is_active }, u.is_active ? `${u.name} disabled.` : `${u.name} enabled.`)}>
                          {u.is_active ? 'Disable' : 'Enable'}
                        </button>
                        <button
                          className="small secondary"
                          onClick={() => {
                            const p = prompt(`New password for ${u.name} (min 6 characters)`);
                            if (p) update(u.user_id, { password: p }, 'Password reset.');
                          }}
                        >
                          Reset password
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <form className="card" onSubmit={create}>
          <h2>Add a staff member</h2>
          <div className="form-grid">
            <label className="wide">
              Name
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </label>
            <label>
              Mobile
              <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} required inputMode="numeric" />
            </label>
            <label>
              Password
              <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required minLength={6} />
            </label>
          </div>
          <div className="row" style={{ marginTop: 10, justifyContent: 'flex-end' }}>
            <button className="green">Add staff</button>
          </div>
        </form>
      </div>
    </>
  );
}
