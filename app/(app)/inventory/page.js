'use client';
import { useState } from 'react';
import { api, fmtDate, fmtDateTime, inr, statusBadge, useApi } from '@/lib/client';
import StockInForm from '@/components/StockInForm';

const TABS = [
  ['stock', 'Stock'],
  ['expiring', 'Expiring soon'],
  ['alerts', 'Alerts'],
  ['movements', 'Stock movements'],
  ['stockin', '+ Stock-in'],
];

export default function InventoryPage() {
  const [tab, setTab] = useState('stock');
  const [filter, setFilter] = useState('');
  const [msg, setMsg] = useState(null);
  const me = useApi('/api/auth/me');
  const data = useApi(tab === 'stockin' ? null : `/api/inventory?view=${tab}`);
  const isOwner = me.data?.user.role === 'owner';

  async function writeOff() {
    if (!confirm('Write off all expired stock? This records an "expired" movement for each batch.')) return;
    try {
      const r = await api('/api/inventory/write-off', { method: 'POST' });
      setMsg({ ok: true, text: `Wrote off ${r.units} units from ${r.batches} expired batches.` });
      data.reload();
    } catch (e) {
      setMsg({ ok: false, text: e.message });
    }
  }

  async function resolve(id) {
    await api(`/api/inventory/alerts/${id}`, { method: 'PATCH' });
    data.reload();
  }

  const rows = (data.data?.rows || []).filter((r) => !filter || `${r.name} ${r.brand || ''} ${r.category || ''}`.toLowerCase().includes(filter.toLowerCase()));
  const expiredUnits = tab === 'stock' ? rows.reduce((a, r) => a + Number(r.expired_qty || 0), 0) : 0;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Inventory</h1>
          <p>Batch-wise stock. Sales always pick the batch that expires first (FEFO).</p>
        </div>
        {isOwner && (
          <button className="danger" onClick={writeOff}>
            Write off expired stock
          </button>
        )}
      </div>
      {msg && <div className={`alert ${msg.ok ? 'ok' : 'error'}`}>{msg.text}</div>}

      <div className="tabs">
        {TABS.map(([k, label]) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </div>

      <div className="card">
        {tab === 'stockin' ? (
          <StockInForm onSaved={() => setMsg({ ok: true, text: 'Stock added. Low-stock alerts update automatically.' })} />
        ) : (
          <>
            {tab === 'stock' && (
              <div className="row" style={{ marginBottom: 10 }}>
                <input placeholder="Filter by name, brand or category" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ width: 300 }} />
                <span className="spacer" />
                {expiredUnits > 0 && <span className="badge red">{expiredUnits} expired units still on shelf</span>}
              </div>
            )}
            {data.loading && <div className="empty">Loading...</div>}
            {data.error && <div className="alert error">{data.error}</div>}
            {!data.loading && !rows.length && <div className="empty">Nothing here.</div>}
            {!!rows.length && (
              <div className="table-wrap">
                {tab === 'stock' && (
                  <table>
                    <thead>
                      <tr>
                        <th>Product</th>
                        <th>Category</th>
                        <th className="num">Price</th>
                        <th className="num">In stock</th>
                        <th className="num">Reorder at</th>
                        <th>Nearest expiry</th>
                        <th className="num">Expired</th>
                        <th className="num">Stock value</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.product_id}>
                          <td>
                            <b>{r.name}</b> <span className="muted small">{r.size_label}</span>
                            <div className="small muted">{r.brand}</div>
                          </td>
                          <td className="small">{r.category}</td>
                          <td className="num">{inr(r.selling_price)}</td>
                          <td className="num">
                            <b>{r.stock}</b>
                          </td>
                          <td className="num muted">{r.reorder_level}</td>
                          <td>{fmtDate(r.nearest_expiry)}</td>
                          <td className="num">{r.expired_qty > 0 ? <span className="badge red">{r.expired_qty}</span> : '-'}</td>
                          <td className="num">{inr(r.stock_value, true)}</td>
                          <td>
                            <span className={`badge ${statusBadge(r.status)}`}>{r.status}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {tab === 'expiring' && (
                  <table>
                    <thead>
                      <tr>
                        <th>Product</th>
                        <th>Batch</th>
                        <th>Expiry</th>
                        <th className="num">Days left</th>
                        <th className="num">Qty</th>
                        <th className="num">Value at risk</th>
                        <th className="num">Suggested discount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.batch_id}>
                          <td>
                            <b>{r.name}</b> <span className="muted small">{r.size_label}</span>
                          </td>
                          <td className="mono">{r.batch_no}</td>
                          <td>{fmtDate(r.expiry_date)}</td>
                          <td className="num">
                            <span className={`badge ${r.days_left <= 2 ? 'red' : 'amber'}`}>{r.days_left}d</span>
                          </td>
                          <td className="num">{r.qty_remaining}</td>
                          <td className="num">{inr(r.value_at_risk)}</td>
                          <td className="num">{r.suggested_discount_pct}% off</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {tab === 'alerts' && (
                  <table>
                    <thead>
                      <tr>
                        <th>When</th>
                        <th>Type</th>
                        <th>Message</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.alert_id}>
                          <td>{fmtDateTime(r.created_at)}</td>
                          <td>
                            <span className="badge amber">{r.kind.replace('_', ' ')}</span>
                          </td>
                          <td>{r.message}</td>
                          <td className="num">
                            <button className="small secondary" onClick={() => resolve(r.alert_id)}>
                              Dismiss
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {tab === 'movements' && (
                  <table>
                    <thead>
                      <tr>
                        <th>When</th>
                        <th>Product</th>
                        <th>Batch</th>
                        <th>Reason</th>
                        <th className="num">Change</th>
                        <th>Ref</th>
                        <th>By</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.movement_id}>
                          <td>{fmtDateTime(r.created_at)}</td>
                          <td>{r.name}</td>
                          <td className="mono">{r.batch_no}</td>
                          <td>
                            <span className={`badge ${r.reason === 'sale' ? 'blue' : r.reason === 'purchase' ? 'green' : 'red'}`}>{r.reason}</span>
                          </td>
                          <td className="num" style={{ color: r.change_qty < 0 ? 'var(--red)' : 'var(--green)' }}>
                            {r.change_qty > 0 ? '+' : ''}
                            {r.change_qty}
                          </td>
                          <td className="mono">{r.ref_id ? `#${r.ref_id}` : '-'}</td>
                          <td className="small muted">{r.by_user || 'system'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
