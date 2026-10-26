'use client';
import Link from 'next/link';
import { useState } from 'react';
import { api, fmtDateTime, inr, riskBadge, useApi } from '@/lib/client';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const HOURS = Array.from({ length: 16 }, (_, i) => i + 7); // 7am - 10pm

export default function ReportsPage() {
  const { data, error, reload } = useApi('/api/reports');
  const [refreshing, setRefreshing] = useState(false);

  async function refreshMv() {
    setRefreshing(true);
    await api('/api/reports/refresh', { method: 'POST' });
    await reload();
    setRefreshing(false);
  }

  if (error) return <div className="alert error">{error}</div>;
  if (!data) return <div className="empty">Crunching numbers...</div>;
  const { kpis, daily, topProducts, categories, staff, modes, reorder, risk, monthly, mongo } = data;
  const maxDay = Math.max(1, ...daily.map((d) => Number(d.revenue)));
  const maxCat = Math.max(1, ...categories.map((c) => Number(c.revenue)));
  const heat = new Map((mongo?.heatmap || []).map((h) => [`${h.dow}-${h.hour}`, h.bills]));
  const maxHeat = Math.max(1, ...(mongo?.heatmap || []).map((h) => h.bills));
  const modeTotal = modes.reduce((a, m) => a + Number(m.amount), 0) || 1;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Reports</h1>
          <p>SQL views, window functions and a materialized view (PostgreSQL) + aggregation pipelines (MongoDB).</p>
        </div>
      </div>

      <div className="grid kpis" style={{ marginBottom: 16 }}>
        <Kpi label="Today's sales" value={inr(kpis.today_revenue, true)} sub={`${kpis.today_bills} bills`} />
        <Kpi label="Profit this month" value={inr(kpis.month_profit, true)} sub="selling price − batch cost" />
        <Kpi label="Udhaar outstanding" value={inr(kpis.outstanding_credit, true)} sub={`${kpis.debtors} customers`} color="var(--red)" />
        <Kpi label="Stock value (at cost)" value={inr(kpis.stock_value, true)} sub={`${kpis.open_alerts} open alerts`} />
      </div>

      <div className="grid two" style={{ marginBottom: 16 }}>
        <div className="card">
          <h2>Last 14 days</h2>
          <div className="bars">
            {daily.map((d) => {
              const h = (100 * Number(d.revenue)) / maxDay;
              const credit = Number(d.revenue) ? (h * Number(d.credit_sales)) / Number(d.revenue) : 0;
              return (
                <div className="bar" key={d.sale_date} title={`${inr(d.revenue)} · ${d.invoices} bills`}>
                  <i className="credit" style={{ height: `${credit}%` }} />
                  <i style={{ height: `${h - credit}%`, borderRadius: credit ? 0 : undefined, order: -1 }} />
                  <span>{new Date(d.sale_date).getDate()}</span>
                </div>
              );
            })}
          </div>
          <div className="legend">
            <span>
              <i style={{ background: 'var(--ink)' }} />
              cash + UPI
            </span>
            <span>
              <i style={{ background: 'var(--accent)' }} />
              udhaar
            </span>
          </div>
        </div>

        <div className="card">
          <h2>Busy hours (MongoDB $group by weekday × hour)</h2>
          {mongo ? (
            <>
              <div className="heat">
                <span />
                {HOURS.map((h) => (
                  <span key={h} className="lbl">
                    {h % 12 || 12}
                  </span>
                ))}
                {DAYS.map((d, di) => (
                  <Row key={d} d={d}>
                    {HOURS.map((h) => {
                      const v = heat.get(`${di + 1}-${h}`) || 0;
                      return (
                        <span
                          key={h}
                          className="cell"
                          title={`${d} ${h}:00 - ${v} bills`}
                          style={{ background: v ? `rgba(217,115,26,${0.15 + (0.85 * v) / maxHeat})` : undefined }}
                        />
                      );
                    })}
                  </Row>
                ))}
              </div>
              <p className="small muted">Darker = more bills. Plan staff shifts around the peaks.</p>
            </>
          ) : (
            <div className="empty">MongoDB not connected - start it with docker compose.</div>
          )}
        </div>
      </div>

      <div className="grid two" style={{ marginBottom: 16 }}>
        <div className="card">
          <h2>Top products, 30 days (GROUP BY … HAVING units ≥ 5)</h2>
          <table>
            <thead>
              <tr>
                <th>Product</th>
                <th className="num">Units</th>
                <th className="num">Revenue</th>
                <th className="num">Margin</th>
              </tr>
            </thead>
            <tbody>
              {topProducts.map((p) => (
                <tr key={p.name + p.size_label}>
                  <td>
                    {p.name} <span className="muted small">{p.size_label}</span>
                  </td>
                  <td className="num">{p.units}</td>
                  <td className="num">{inr(p.revenue, true)}</td>
                  <td className="num">{p.margin_pct}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card">
          <h2>Revenue by category</h2>
          {categories.map((c) => (
            <div className="hbar" key={c.category}>
              <span className="small">{c.category}</span>
              <div className="track">
                <i style={{ width: `${(100 * c.revenue) / maxCat}%` }} />
              </div>
              <span className="small num">{inr(c.revenue, true)}</span>
            </div>
          ))}
          <h3 style={{ marginTop: 16 }}>Payment modes</h3>
          {modes.map((m) => (
            <div className="hbar" key={m.payment_mode}>
              <span className="small">{m.payment_mode === 'credit' ? 'udhaar' : m.payment_mode}</span>
              <div className="track">
                <i style={{ width: `${(100 * m.amount) / modeTotal}%`, background: m.payment_mode === 'credit' ? 'var(--red)' : 'var(--ink)' }} />
              </div>
              <span className="small num">{Math.round((100 * m.amount) / modeTotal)}%</span>
            </div>
          ))}
        </div>
      </div>

      <div className="grid two" style={{ marginBottom: 16 }}>
        <div className="card">
          <h2>Reorder now (moving-average forecast)</h2>
          {!reorder.length && <div className="empty">Nothing to reorder.</div>}
          {!!reorder.length && (
            <table>
              <thead>
                <tr>
                  <th>Product</th>
                  <th className="num">Stock</th>
                  <th className="num">Sells / day</th>
                  <th className="num">Days left</th>
                  <th className="num">Order</th>
                </tr>
              </thead>
              <tbody>
                {reorder.map((r) => (
                  <tr key={r.product_id}>
                    <td>
                      {r.name} <span className="muted small">{r.size_label}</span>
                    </td>
                    <td className="num">{r.stock}</td>
                    <td className="num">{r.avg_daily_14d}</td>
                    <td className="num">
                      <span className={`badge ${r.days_of_stock_left === null || r.days_of_stock_left < 3 ? 'red' : 'amber'}`}>{r.days_of_stock_left ?? '0'}</span>
                    </td>
                    <td className="num">
                      <b>{r.suggested_order_qty}</b>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="card">
          <h2>Riskiest udhaar accounts</h2>
          <table>
            <tbody>
              {risk.map((c) => (
                <tr key={c.customer_id}>
                  <td>
                    <Link href={`/customers/${c.customer_id}`}>{c.name}</Link>
                    <div className="small muted">last paid {c.days_since_payment}d ago</div>
                  </td>
                  <td className="num">
                    {inr(c.current_balance, true)}
                    <div className="small muted">of {inr(c.credit_limit, true)}</div>
                  </td>
                  <td className="num">
                    <span className={`badge ${riskBadge(c.risk_band)}`}>{c.risk_score}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid two" style={{ marginBottom: 16 }}>
        <div className="card">
          <div className="row">
            <h2 style={{ margin: 0 }}>Monthly P&amp;L (materialized view)</h2>
            <span className="spacer" />
            <button className="small secondary" onClick={refreshMv} disabled={refreshing}>
              {refreshing ? 'Refreshing...' : 'REFRESH'}
            </button>
          </div>
          <table>
            <thead>
              <tr>
                <th>Month</th>
                <th className="num">Bills</th>
                <th className="num">Sales</th>
                <th className="num">Gross profit</th>
                <th className="num">Udhaar share</th>
              </tr>
            </thead>
            <tbody>
              {monthly.map((m) => (
                <tr key={m.month}>
                  <td>{new Date(m.month).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}</td>
                  <td className="num">{m.invoices}</td>
                  <td className="num">{inr(m.gross_sales, true)}</td>
                  <td className="num">{inr(m.gross_profit, true)}</td>
                  <td className="num">{m.credit_share_pct}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card">
          <h2>Staff, 30 days</h2>
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th className="num">Bills</th>
                <th className="num">Revenue</th>
                <th className="num">Avg bill</th>
              </tr>
            </thead>
            <tbody>
              {staff.map((s) => (
                <tr key={s.user_id}>
                  <td>{s.name}</td>
                  <td className="num">{s.bills}</td>
                  <td className="num">{inr(s.revenue, true)}</td>
                  <td className="num">{inr(s.avg_bill)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {mongo && (
        <div className="grid two">
          <div className="card">
            <h2>Activity by type (MongoDB $facet)</h2>
            {mongo.byAction.map((a) => (
              <div key={a._id} className="row small" style={{ justifyContent: 'space-between', borderBottom: '1px solid var(--line)', padding: '4px 0' }}>
                <span className="mono">{a._id}</span>
                <b>{a.count}</b>
              </div>
            ))}
            {mongo.scanStats && (
              <p className="small muted">
                Bill scans: {mongo.scanStats.scans}, lines auto-matched {mongo.scanStats.matched}/{mongo.scanStats.lines}, applied {mongo.scanStats.applied}
              </p>
            )}
          </div>
          <div className="card">
            <h2>Latest activity log</h2>
            {mongo.recent.map((r, i) => (
              <div key={i} className="small" style={{ borderBottom: '1px solid var(--line)', padding: '4px 0' }}>
                <span className="muted">{fmtDateTime(r.at)}</span> · <span className="mono">{r.action}</span> · {r.userName || '-'}
                {r.meta?.total !== undefined && <> · {inr(r.meta.total)}</>}
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

function Kpi({ label, value, sub, color }) {
  return (
    <div className="card stat">
      <span className="label">{label}</span>
      <span className="value" style={color ? { color } : undefined}>
        {value}
      </span>
      <span className="sub">{sub}</span>
    </div>
  );
}

function Row({ d, children }) {
  return (
    <>
      <span className="lbl">{d}</span>
      {children}
    </>
  );
}
