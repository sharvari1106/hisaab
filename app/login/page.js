'use client';
import { useState } from 'react';
import { api } from '@/lib/client';

const DEMO = [
  ['Owner', '9876543210'],
  ['Staff', '9876543211'],
  ['Customer', '9845012345'],
  ['Admin', '9999900000'],
];

export default function LoginPage() {
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await api('/api/auth/login', { method: 'POST', body: { phone, password } });
      const next = new URLSearchParams(window.location.search).get('next');
      window.location.href = next && next.startsWith('/') && !next.startsWith('//') ? next : res.home;
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <section className="login-art">
        <h1>
          Hisaab<span>.</span>
        </h1>
        <p style={{ fontSize: '1.15rem', margin: 0 }}>The kirana notebook, rebuilt on a real database.</p>
        <ul>
          <li>Bill in seconds - search &ldquo;doodh&rdquo;, &ldquo;paal&rdquo; or &ldquo;magi noodels&rdquo;</li>
          <li>Udhaar ledger with automatic credit limits</li>
          <li>Batch-wise stock with expiry tracking (FEFO)</li>
          <li>Scan a supplier bill, stock updates itself</li>
          <li>Know which customers are risky before giving credit</li>
        </ul>
      </section>
      <section className="login-form">
        <form className="card" onSubmit={submit}>
          <h2>Log in</h2>
          <label>
            Mobile number
            <input inputMode="numeric" autoComplete="username" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="10-digit mobile" required />
          </label>
          <label>
            Password
            <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </label>
          {error && <div className="alert error">{error}</div>}
          <button className="accent big" disabled={busy}>
            {busy ? 'Checking...' : 'Log in'}
          </button>
          <div className="demo-logins muted">
            Demo accounts (password <span className="mono">password123</span>):
            <div>
              {DEMO.map(([label, ph]) => (
                <button
                  type="button"
                  key={ph}
                  className="small secondary"
                  onClick={() => {
                    setPhone(ph);
                    setPassword('password123');
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </form>
      </section>
    </div>
  );
}
