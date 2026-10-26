'use client';
import { useState } from 'react';
import { api, inr, useApi } from '@/lib/client';

const emptyLine = () => ({ productId: '', qty: '', costPrice: '', batchNo: '', mfgDate: '', expiryDate: '' });

/**
 * Stock-in form. `initialLines` lets the bill-scan page pre-fill matched lines.
 * Every line becomes a batch; the whole bill is saved in one transaction.
 */
export default function StockInForm({ initialLines, scanId, onSaved, defaultSupplierId = '' }) {
  const products = useApi('/api/products');
  const suppliers = useApi('/api/suppliers');
  const [supplierId, setSupplierId] = useState(defaultSupplierId);
  const [invoiceNo, setInvoiceNo] = useState('');
  const [purchaseDate, setPurchaseDate] = useState(new Date().toISOString().slice(0, 10));
  const [lines, setLines] = useState(initialLines?.length ? initialLines : [emptyLine()]);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  const update = (i, k, v) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  const total = lines.reduce((a, l) => a + (Number(l.qty) || 0) * (Number(l.costPrice) || 0), 0);

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const used = lines.filter((l) => l.productId);
      const r = await api('/api/purchases', {
        method: 'POST',
        body: {
          supplierId,
          invoiceNo,
          purchaseDate,
          scanId,
          items: used.map((l) => ({ ...l, qty: Number(l.qty), costPrice: Number(l.costPrice) })),
        },
      });
      setMsg({ ok: true, text: `Saved purchase #${r.purchase.purchase_id} - ${inr(r.purchase.total_amount)} (${used.length} batches added).` });
      setLines([emptyLine()]);
      setInvoiceNo('');
      onSaved?.(r.purchase);
    } catch (err) {
      setMsg({ ok: false, text: err.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save}>
      <div className="form-grid">
        <label>
          Supplier
          <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} required>
            <option value="">Choose...</option>
            {suppliers.data?.suppliers.map((s) => (
              <option key={s.supplier_id} value={s.supplier_id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Supplier bill no.
          <input value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} required placeholder="e.g. SGF-90011" />
        </label>
        <label>
          Bill date
          <input type="date" value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} />
        </label>
      </div>

      <div className="table-wrap" style={{ marginTop: 12 }}>
        <table>
          <thead>
            <tr>
              <th style={{ minWidth: 220 }}>Product</th>
              <th>Qty</th>
              <th>Cost / unit</th>
              <th>Batch</th>
              <th>Mfg</th>
              <th>Expiry</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i}>
                <td>
                  {l.raw && <div className="small muted mono">{l.raw}</div>}
                  <select value={l.productId} onChange={(e) => update(i, 'productId', e.target.value)} style={{ width: '100%' }}>
                    <option value="">- skip this line -</option>
                    {(l.candidates?.length ? l.candidates : []).map((c) => (
                      <option key={`c${c.product_id}`} value={c.product_id}>
                        ★ {c.name} {c.size_label || ''} ({c.matched_by})
                      </option>
                    ))}
                    {products.data?.products.map((p) => (
                      <option key={p.product_id} value={p.product_id}>
                        {p.name} {p.size_label || ''}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <input style={{ width: 70 }} inputMode="numeric" value={l.qty} onChange={(e) => update(i, 'qty', e.target.value)} />
                </td>
                <td>
                  <input style={{ width: 90 }} inputMode="decimal" value={l.costPrice} onChange={(e) => update(i, 'costPrice', e.target.value)} />
                </td>
                <td>
                  <input style={{ width: 90 }} value={l.batchNo} onChange={(e) => update(i, 'batchNo', e.target.value)} />
                </td>
                <td>
                  <input type="date" value={l.mfgDate} onChange={(e) => update(i, 'mfgDate', e.target.value)} />
                </td>
                <td>
                  <input type="date" value={l.expiryDate} onChange={(e) => update(i, 'expiryDate', e.target.value)} />
                </td>
                <td>
                  <button type="button" className="small danger" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="row" style={{ marginTop: 10 }}>
        <button type="button" className="secondary" onClick={() => setLines((ls) => [...ls, emptyLine()])}>
          + Add line
        </button>
        <span className="spacer" />
        <b>Bill total {inr(total)}</b>
        <button className="green" disabled={busy}>
          {busy ? 'Saving...' : 'Save stock-in'}
        </button>
      </div>
      {msg && <div className={`alert ${msg.ok ? 'ok' : 'error'}`}>{msg.text}</div>}
    </form>
  );
}
