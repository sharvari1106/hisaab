'use client';
import { fmtDateTime, inr, useApi } from '@/lib/client';

export default function Receipt({ invoiceId, onClose }) {
  const { data, error, loading } = useApi(`/api/sales/${invoiceId}`);
  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(31,42,68,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 16 }}
    >
      <div className="card" style={{ width: 420, maxWidth: '100%', maxHeight: '90vh', overflow: 'auto' }} onClick={(e) => e.stopPropagation()}>
        {loading && <div className="empty">Loading...</div>}
        {error && <div className="alert error">{error}</div>}
        {data && (
          <div className="receipt">
            <div style={{ textAlign: 'center' }}>
              <b>{data.invoice.shop_name}</b>
              <div>{data.invoice.shop_address}</div>
              {data.invoice.gstin && <div>GSTIN {data.invoice.gstin}</div>}
              <div>------------------------------</div>
              <div>
                Bill #{data.invoice.invoice_id} · {fmtDateTime(data.invoice.created_at)}
              </div>
              {data.invoice.customer_name && <div>Customer: {data.invoice.customer_name}</div>}
              <div>Billed by: {data.invoice.staff_name}</div>
              <div>------------------------------</div>
            </div>
            <table>
              <tbody>
                {data.items.map((it, i) => (
                  <tr key={i}>
                    <td>
                      {it.name} {it.size_label}
                      <div className="muted" style={{ fontSize: '0.75rem' }}>
                        {it.qty} × {inr(it.unit_price)} · batch {it.batches}
                      </div>
                    </td>
                    <td className="num">{inr(it.line_total)}</td>
                  </tr>
                ))}
                <tr>
                  <td>Subtotal</td>
                  <td className="num">{inr(data.invoice.subtotal)}</td>
                </tr>
                {Number(data.invoice.discount) > 0 && (
                  <tr>
                    <td>Discount</td>
                    <td className="num">−{inr(data.invoice.discount)}</td>
                  </tr>
                )}
                <tr>
                  <td>
                    <b>TOTAL ({data.invoice.payment_mode.toUpperCase()})</b>
                  </td>
                  <td className="num">
                    <b>{inr(data.invoice.total)}</b>
                  </td>
                </tr>
              </tbody>
            </table>
            <div style={{ textAlign: 'center', marginTop: 8 }}>Thank you! Visit again.</div>
          </div>
        )}
        <div className="row no-print" style={{ marginTop: 12, justifyContent: 'flex-end' }}>
          <button className="secondary" onClick={() => window.print()}>
            Print
          </button>
          <button onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
