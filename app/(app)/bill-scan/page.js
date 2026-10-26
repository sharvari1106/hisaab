'use client';
import { useState } from 'react';
import { api, useApi } from '@/lib/client';
import StockInForm from '@/components/StockInForm';

const SAMPLE = `SRI GANESH FMCG TRADERS
Invoice No: SGF-90011   Date: 20/10/2026
Sl Item                       Qty   Rate    Amount
1. SURF XL EZY WSH 1KG         10   115.00  1150.00
2  MAGGI 2MIN NDL 70G          48   11.50    552.00
3) PARLE G 250G                24   20.00    480.00
4  COLGATE STRNG TEETH 200G     6   92.00    552.00
5  TOOR DAL TATA 1KG            5   138.00   690.00
6  COCONUT OIL PARACHUTE 250ML 12   94.00   1128.00
GST 5%                                      227.60
Grand Total                                4779.60`;

export default function BillScanPage() {
  const suppliers = useApi('/api/suppliers');
  const [supplierId, setSupplierId] = useState('');
  const [text, setText] = useState('');
  const [ocr, setOcr] = useState(null); // progress text
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  // OCR runs in the browser (tesseract.js, WebAssembly) - the photo never leaves the device
  async function runOcr(file) {
    if (!file) return;
    setError(null);
    setOcr('Loading OCR engine...');
    try {
      const Tesseract = (await import('tesseract.js')).default;
      const { data } = await Tesseract.recognize(file, 'eng', {
        logger: (m) => m.status && setOcr(`${m.status} ${m.progress ? Math.round(m.progress * 100) + '%' : ''}`),
      });
      setText(data.text);
      setOcr(null);
    } catch (e) {
      setOcr(null);
      setError(`OCR failed: ${e.message}. You can paste the bill text instead.`);
    }
  }

  async function match() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setResult(await api('/api/bill-scan/match', { method: 'POST', body: { text, supplierId: supplierId || null } }));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const initialLines = result?.lines.map((l) => ({
    raw: l.raw,
    candidates: l.candidates,
    productId: l.productId ? String(l.productId) : '',
    qty: String(l.qty ?? ''),
    costPrice: l.rate != null ? String(l.rate) : '',
    batchNo: '',
    mfgDate: '',
    expiryDate: '',
  }));

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Scan a supplier bill</h1>
          <p>Photo → OCR → each line is matched to your catalogue by hybrid (text + fuzzy + vector) search → one-click stock-in.</p>
        </div>
      </div>

      {!result && (
        <div className="card">
          <div className="form-grid">
            <label>
              Supplier
              <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
                <option value="">Choose...</option>
                {suppliers.data?.suppliers.map((s) => (
                  <option key={s.supplier_id} value={s.supplier_id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Bill photo (optional)
              <input type="file" accept="image/*" capture="environment" onChange={(e) => runOcr(e.target.files?.[0])} />
            </label>
          </div>
          {ocr && <div className="alert info">{ocr}</div>}
          <label style={{ marginTop: 10 }}>
            Bill text (from OCR, or paste / type it)
            <textarea rows={12} className="mono" value={text} onChange={(e) => setText(e.target.value)} placeholder="One item per line: name   qty   rate   amount" />
          </label>
          {error && <div className="alert error">{error}</div>}
          <div className="row" style={{ marginTop: 10 }}>
            <button type="button" className="secondary" onClick={() => setText(SAMPLE)}>
              Use sample bill
            </button>
            <span className="spacer" />
            <button className="accent" onClick={match} disabled={busy || text.trim().length < 4}>
              {busy ? 'Matching...' : 'Match items'}
            </button>
          </div>
        </div>
      )}

      {result && (
        <div className="card">
          <div className="row" style={{ marginBottom: 10 }}>
            <span>
              Found <b>{result.lines.length}</b> lines, matched <b>{result.lines.filter((l) => l.productId).length}</b>
              {result.semantic ? ' (with semantic search)' : ' (text + fuzzy only)'}.
              {result.scanId && <span className="muted small"> Scan saved in MongoDB: {result.scanId}</span>}
            </span>
            <span className="spacer" />
            <button className="secondary" onClick={() => setResult(null)}>
              ← Back
            </button>
          </div>
          <p className="small muted">★ = suggested matches. Check each line, add expiry dates, then save.</p>
          <StockInForm initialLines={initialLines} scanId={result.scanId} defaultSupplierId={supplierId} />
        </div>
      )}
    </>
  );
}
