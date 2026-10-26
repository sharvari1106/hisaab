'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api, fmtDateTime, inr, useApi, whatsappLink } from '@/lib/client';
import Receipt from '@/components/Receipt';

const MATCH_BADGE = { text: 'blue', fuzzy: 'amber', semantic: 'green' };

export default function BillingPage() {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [semantic, setSemantic] = useState(false);
  const [sel, setSel] = useState(0);
  const [subs, setSubs] = useState(null); // { for: name, list: [] }
  const [cart, setCart] = useState([]);
  const [mode, setMode] = useState('cash');
  const [discount, setDiscount] = useState('');
  const [customer, setCustomer] = useState(null);
  const [custQ, setCustQ] = useState('');
  const [custList, setCustList] = useState([]);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const [viewId, setViewId] = useState(null);
  const recent = useApi('/api/sales?limit=12');
  const searchRef = useRef(null);

  // debounced hybrid search
  useEffect(() => {
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const r = await api(`/api/products/search?q=${encodeURIComponent(q)}&limit=8`);
        setResults(r.results);
        setSemantic(r.semantic);
        setSel(0);
      } catch (e) {
        setError({ message: e.message });
      }
    }, 220);
    return () => clearTimeout(t);
  }, [q]);

  // customer lookup
  useEffect(() => {
    if (!custQ.trim()) {
      setCustList([]);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const r = await api(`/api/customers?q=${encodeURIComponent(custQ)}`);
        setCustList(r.customers.slice(0, 6));
      } catch {
        setCustList([]);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [custQ]);

  const subtotal = useMemo(() => cart.reduce((a, l) => a + l.price * l.qty, 0), [cart]);
  const disc = Math.min(Number(discount) || 0, subtotal);
  const total = subtotal - disc;

  function add(p) {
    if (Number(p.stock) <= 0) {
      showSubs(p);
      return;
    }
    setCart((c) => {
      const existing = c.find((l) => l.productId === p.product_id);
      if (existing) return c.map((l) => (l.productId === p.product_id ? { ...l, qty: l.qty + 1 } : l));
      return [...c, { productId: p.product_id, name: p.name, size: p.size_label, price: Number(p.selling_price), qty: 1, stock: Number(p.stock) }];
    });
    setQ('');
    setResults([]);
    setSubs(null);
    setDone(null);
    searchRef.current?.focus();
  }

  async function showSubs(p) {
    try {
      const r = await api(`/api/products/${p.product_id}/similar`);
      setSubs({ for: p.name, list: r.results });
    } catch (e) {
      setError({ message: e.message });
    }
  }

  function setQty(id, qty) {
    setCart((c) => c.map((l) => (l.productId === id ? { ...l, qty: Math.max(1, Math.min(1000, qty || 1)) } : l)));
  }

  function onKey(e) {
    if (!results.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSel((s) => Math.min(s + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSel((s) => Math.max(s - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      add(results[sel]);
    }
  }

  async function checkout() {
    setBusy(true);
    setError(null);
    try {
      const r = await api('/api/sales', {
        method: 'POST',
        body: {
          customerId: customer?.customer_id || null,
          mode,
          discount: disc,
          items: cart.map((l) => ({ productId: l.productId, qty: l.qty })),
        },
      });
      setDone(r.invoice);
      setCart([]);
      setDiscount('');
      setCustomer(null);
      setMode('cash');
      recent.reload();
      searchRef.current?.focus();
    } catch (e) {
      setError({ message: e.message, hint: e.hint });
    } finally {
      setBusy(false);
    }
  }

  const creditAfter = customer ? Number(customer.current_balance) + (mode === 'credit' ? total : 0) : 0;
  const creditPct = customer ? Math.min(100, (100 * creditAfter) / Math.max(1, Number(customer.credit_limit))) : 0;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Billing counter</h1>
          <p>Type in any language or spelling. ↑ ↓ to choose, Enter to add.</p>
        </div>
      </div>

      <div className="grid billing">
        <div className="grid" style={{ gap: 16 }}>
          <div className="card">
            <input
              ref={searchRef}
              autoFocus
              className="search-big"
              placeholder='Search: "doodh", "parle g", "thengai ennai", "magi noodels"...'
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={onKey}
            />
            {q.length >= 2 && (
              <div className="small muted" style={{ marginTop: 6 }}>
                Hybrid search: full-text + fuzzy {semantic ? '+ semantic (vector)' : '(semantic search off - run npm run db:embed)'}
              </div>
            )}
            <div className="results">
              {results.map((p, i) => (
                <div key={p.product_id} className={`result ${i === sel ? 'sel' : ''} ${Number(p.stock) <= 0 ? 'out' : ''}`} onClick={() => add(p)} onMouseEnter={() => setSel(i)}>
                  <div>
                    <div className="pname">
                      {p.name} <span className="muted small">{p.size_label}</span>
                    </div>
                    <div className="small muted">
                      {p.brand}{' '}
                      {p.matched_by.split('+').map((m) => (
                        <span key={m} className={`badge ${MATCH_BADGE[m]}`} style={{ marginLeft: 4 }}>
                          {m}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="num">
                    {Number(p.stock) > 0 ? <span className="small muted">{p.stock} in stock</span> : <span className="badge red">OUT - see substitutes</span>}
                  </div>
                  <div className="num">
                    <b>{inr(p.selling_price)}</b>
                    {Number(p.mrp) > Number(p.selling_price) && (
                      <div className="small muted">
                        <s>{inr(p.mrp)}</s>
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {q.length >= 2 && !results.length && <div className="empty">No match. Try another word.</div>}
            </div>
            {subs && (
              <div className="alert info">
                <b>{subs.for}</b> is out of stock. Closest alternatives in stock:
                <div className="row" style={{ marginTop: 6 }}>
                  {subs.list.length ? (
                    subs.list.map((s) => (
                      <button key={s.product_id} className="small secondary" onClick={() => add({ ...s, stock: s.stock })}>
                        {s.name} {s.size_label} · {inr(s.selling_price)}
                      </button>
                    ))
                  ) : (
                    <span>none found</span>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="card">
            <h2>Recent bills</h2>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Time</th>
                    <th>Customer</th>
                    <th>Mode</th>
                    <th className="num">Items</th>
                    <th className="num">Total</th>
                    <th>By</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.data?.invoices.map((i) => (
                    <tr key={i.invoice_id} className="clickable" onClick={() => setViewId(i.invoice_id)}>
                      <td className="mono">{i.invoice_id}</td>
                      <td>{fmtDateTime(i.created_at)}</td>
                      <td>{i.customer_name || <span className="muted">walk-in</span>}</td>
                      <td>
                        <span className={`badge ${i.payment_mode === 'credit' ? 'red' : i.payment_mode === 'upi' ? 'blue' : 'green'}`}>{i.payment_mode}</span>
                      </td>
                      <td className="num">{i.units}</td>
                      <td className="num">{inr(i.total)}</td>
                      <td className="small muted">{i.staff_name}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="card" style={{ position: 'sticky', top: 16 }}>
          <h2>Current bill</h2>
          {!cart.length && !done && <div className="empty">Cart is empty</div>}
          {done && (
            <div className="alert ok">
              Bill <b>#{done.invoice_id}</b> saved · {inr(done.total)} ({done.payment_mode})
              {done.customer_name && done.payment_mode === 'credit' && (
                <div className="small">
                  {done.customer_name} now owes {inr(done.current_balance)}
                </div>
              )}
              <div className="row" style={{ marginTop: 6 }}>
                <button className="small secondary" onClick={() => setViewId(done.invoice_id)}>
                  View receipt
                </button>
              </div>
            </div>
          )}
          {cart.map((l) => (
            <div key={l.productId} className="cart-line">
              <div>
                <div style={{ fontWeight: 600 }}>{l.name}</div>
                <div className="small muted">
                  {l.size} · {inr(l.price)} {l.qty > l.stock && <span className="badge red">only {l.stock} left</span>}
                </div>
              </div>
              <div className="qty">
                <button className="icon-btn" onClick={() => setQty(l.productId, l.qty - 1)}>
                  −
                </button>
                <input value={l.qty} inputMode="numeric" onChange={(e) => setQty(l.productId, parseInt(e.target.value, 10))} />
                <button className="icon-btn" onClick={() => setQty(l.productId, l.qty + 1)}>
                  +
                </button>
              </div>
              <div className="num" style={{ minWidth: 80 }}>
                <b>{inr(l.price * l.qty)}</b>
                <div>
                  <button className="small danger" style={{ padding: '0 6px', marginTop: 2 }} onClick={() => setCart((c) => c.filter((x) => x.productId !== l.productId))}>
                    remove
                  </button>
                </div>
              </div>
            </div>
          ))}

          {cart.length > 0 && (
            <>
              <div style={{ marginTop: 14 }}>
                <h3>Payment</h3>
                <div className="row">
                  {[
                    ['cash', 'Cash'],
                    ['upi', 'UPI'],
                    ['credit', 'Udhaar'],
                  ].map(([m, label]) => (
                    <button key={m} className={mode === m ? (m === 'credit' ? 'accent' : '') : 'secondary'} onClick={() => setMode(m)}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ marginTop: 12 }}>
                <label>
                  Customer {mode === 'credit' ? '(required for udhaar)' : '(optional)'}
                  {customer ? (
                    <div className="card" style={{ padding: 10, boxShadow: 'none' }}>
                      <div className="row">
                        <b>{customer.name}</b>
                        <span className="muted small">{customer.phone}</span>
                        <span className="spacer" />
                        <button className="small secondary" onClick={() => setCustomer(null)}>
                          change
                        </button>
                      </div>
                      <div className="small muted" style={{ marginTop: 4 }}>
                        Owes {inr(customer.current_balance)} of {inr(customer.credit_limit, true)} limit
                        {mode === 'credit' && <> → after this bill {inr(creditAfter)}</>}
                      </div>
                      <div className={`meter ${creditPct > 100 ? 'bad' : creditPct > 75 ? 'warn' : ''}`}>
                        <i style={{ width: `${Math.min(creditPct, 100)}%` }} />
                      </div>
                      {mode === 'credit' && creditAfter > Number(customer.credit_limit) && (
                        <div className="small" style={{ color: 'var(--red)', marginTop: 4 }}>
                          Over the credit limit - the database will refuse this bill.
                        </div>
                      )}
                    </div>
                  ) : (
                    <>
                      <input placeholder="Search name or phone" value={custQ} onChange={(e) => setCustQ(e.target.value)} />
                      {custList.map((c) => (
                        <div
                          key={c.customer_id}
                          className="result"
                          style={{ gridTemplateColumns: '1fr auto' }}
                          onClick={() => {
                            setCustomer(c);
                            setCustQ('');
                            setCustList([]);
                          }}
                        >
                          <span>
                            {c.name} <span className="muted small">{c.phone}</span>
                          </span>
                          <span className="small muted">owes {inr(c.current_balance, true)}</span>
                        </div>
                      ))}
                    </>
                  )}
                </label>
              </div>

              <div className="row" style={{ marginTop: 12 }}>
                <label style={{ flex: 1 }}>
                  Discount (₹)
                  <input inputMode="decimal" value={discount} onChange={(e) => setDiscount(e.target.value)} placeholder="0" />
                </label>
                <div className="num" style={{ flex: 1 }}>
                  <div className="small muted">Subtotal {inr(subtotal)}</div>
                  {disc > 0 && <div className="small muted">Discount −{inr(disc)}</div>}
                </div>
              </div>

              <div className="total-line">
                <span>Total</span>
                <span>{inr(total)}</span>
              </div>

              {error && (
                <div className="alert error">
                  {error.message}
                  {error.hint && <div className="small">{error.hint}</div>}
                </div>
              )}

              <button className={`big ${mode === 'credit' ? 'accent' : 'green'}`} disabled={busy || (mode === 'credit' && !customer)} onClick={checkout}>
                {busy ? 'Saving...' : mode === 'credit' ? `Add ${inr(total)} to khata` : `Collect ${inr(total)}`}
              </button>
              {customer && done === null && mode === 'credit' && (
                <a className="small muted" style={{ display: 'block', marginTop: 8 }} href={whatsappLink(customer.phone, `Namaste ${customer.name}, your Hisaab balance is ${inr(creditAfter)}.`)} target="_blank" rel="noreferrer">
                  Send balance on WhatsApp
                </a>
              )}
            </>
          )}
        </div>
      </div>

      {viewId && <Receipt invoiceId={viewId} onClose={() => setViewId(null)} />}
    </>
  );
}
