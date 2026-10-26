'use client';
import { useState } from 'react';
import { api, inr, statusBadge, useApi } from '@/lib/client';

const blank = { name: '', brand: '', sizeLabel: '', unit: 'pcs', categoryId: '', mrp: '', sellingPrice: '', reorderLevel: '5', aliases: '', attributes: '' };

export default function ProductsPage() {
  const [q, setQ] = useState('');
  const list = useApi(`/api/products${q ? `?q=${encodeURIComponent(q)}` : ''}`);
  const cats = useApi('/api/categories');
  const [form, setForm] = useState(blank);
  const [show, setShow] = useState(false);
  const [msg, setMsg] = useState(null);
  const [edit, setEdit] = useState(null); // { id, sellingPrice, mrp, reorderLevel, aliases }
  const [busy, setBusy] = useState(false);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function create(e) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const r = await api('/api/products', { method: 'POST', body: form });
      setMsg({ ok: true, text: `Added ${r.product.name}${r.embedded ? ' (embedding stored for semantic search)' : ' (no embedding - model unavailable)'}.` });
      setForm(blank);
      setShow(false);
      list.reload();
    } catch (err) {
      setMsg({ ok: false, text: err.message });
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit() {
    try {
      await api(`/api/products/${edit.id}`, {
        method: 'PATCH',
        body: { sellingPrice: edit.sellingPrice, mrp: edit.mrp, reorderLevel: edit.reorderLevel, aliases: edit.aliases },
      });
      setEdit(null);
      setMsg({ ok: true, text: 'Saved.' });
      list.reload();
    } catch (err) {
      setMsg({ ok: false, text: err.message });
    }
  }

  async function reembed() {
    setBusy(true);
    setMsg({ ok: true, text: 'Computing embeddings... (first run downloads the model, ~1 min)' });
    try {
      const r = await api('/api/products/reembed', { method: 'POST' });
      setMsg({ ok: r.embedded > 0, text: r.message });
      list.reload();
    } catch (err) {
      setMsg({ ok: false, text: err.message });
    } finally {
      setBusy(false);
    }
  }

  const products = list.data?.products || [];
  const embedded = products.filter((p) => p.has_embedding).length;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Products</h1>
          <p>
            {products.length} products · {embedded} with vector embeddings · aliases make local names searchable
          </p>
        </div>
        <div className="row">
          <button className="secondary" onClick={reembed} disabled={busy}>
            Recompute embeddings
          </button>
          <button className="accent" onClick={() => setShow((s) => !s)}>
            {show ? 'Close' : '+ New product'}
          </button>
        </div>
      </div>
      {msg && <div className={`alert ${msg.ok ? 'ok' : 'error'}`}>{msg.text}</div>}

      {show && (
        <form className="card" onSubmit={create} style={{ marginBottom: 16 }}>
          <h2>New product</h2>
          <div className="form-grid">
            <label>
              Name
              <input value={form.name} onChange={set('name')} required placeholder="Taaza Toned Milk" />
            </label>
            <label>
              Brand
              <input value={form.brand} onChange={set('brand')} placeholder="Amul" />
            </label>
            <label>
              Size
              <input value={form.sizeLabel} onChange={set('sizeLabel')} placeholder="500 ml" />
            </label>
            <label>
              Unit
              <select value={form.unit} onChange={set('unit')}>
                {['pcs', 'pack', 'kg', 'g', 'l', 'ml', 'dozen'].map((u) => (
                  <option key={u}>{u}</option>
                ))}
              </select>
            </label>
            <label>
              Category
              <select value={form.categoryId} onChange={set('categoryId')}>
                <option value="">-</option>
                {cats.data?.categories.map((c) => (
                  <option key={c.category_id} value={c.category_id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              MRP (₹)
              <input inputMode="decimal" value={form.mrp} onChange={set('mrp')} required />
            </label>
            <label>
              Selling price (₹)
              <input inputMode="decimal" value={form.sellingPrice} onChange={set('sellingPrice')} required />
            </label>
            <label>
              Reorder level
              <input inputMode="numeric" value={form.reorderLevel} onChange={set('reorderLevel')} />
            </label>
            <label className="wide">
              Aliases - local names, comma separated, optional language: doodh(hi), haalu(kn), paal(ta)
              <input value={form.aliases} onChange={set('aliases')} />
            </label>
            <label className="wide">
              Attributes (stored in MongoDB, any keys) - one per line: veg=true, flavour=masala, weight_g=500
              <textarea rows={3} value={form.attributes} onChange={set('attributes')} placeholder={'veg=true\nflavour=masala'} />
            </label>
          </div>
          <div className="row" style={{ marginTop: 10 }}>
            <span className="small muted">The database rejects a selling price above MRP (CHECK constraint).</span>
            <span className="spacer" />
            <button className="green" disabled={busy}>
              Save product
            </button>
          </div>
        </form>
      )}

      <div className="card">
        <input placeholder="Filter by name or brand" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 300, marginBottom: 10 }} />
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Product</th>
                <th>Aliases</th>
                <th>Attributes (Mongo)</th>
                <th className="num">MRP</th>
                <th className="num">Price</th>
                <th className="num">Reorder</th>
                <th className="num">Stock</th>
                <th>Vector</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {products.map((p) =>
                edit?.id === p.product_id ? (
                  <tr key={p.product_id}>
                    <td>
                      <b>{p.name}</b>
                    </td>
                    <td colSpan={2}>
                      <input style={{ width: '100%' }} value={edit.aliases} onChange={(e) => setEdit({ ...edit, aliases: e.target.value })} />
                    </td>
                    <td className="num">
                      <input style={{ width: 70 }} value={edit.mrp} onChange={(e) => setEdit({ ...edit, mrp: e.target.value })} />
                    </td>
                    <td className="num">
                      <input style={{ width: 70 }} value={edit.sellingPrice} onChange={(e) => setEdit({ ...edit, sellingPrice: e.target.value })} />
                    </td>
                    <td className="num">
                      <input style={{ width: 55 }} value={edit.reorderLevel} onChange={(e) => setEdit({ ...edit, reorderLevel: e.target.value })} />
                    </td>
                    <td />
                    <td />
                    <td className="num">
                      <button className="small green" onClick={saveEdit}>
                        Save
                      </button>{' '}
                      <button className="small secondary" onClick={() => setEdit(null)}>
                        Cancel
                      </button>
                    </td>
                  </tr>
                ) : (
                  <tr key={p.product_id}>
                    <td>
                      <b>{p.name}</b> <span className="muted small">{p.size_label}</span>
                      <div className="small muted">
                        {p.brand} · {p.category}
                      </div>
                    </td>
                    <td className="small">{p.aliases || <span className="muted">-</span>}</td>
                    <td className="small mono">
                      {p.attributes
                        ? Object.entries(p.attributes)
                            .map(([k, v]) => `${k}=${v}`)
                            .join(' ')
                        : '-'}
                    </td>
                    <td className="num">{inr(p.mrp)}</td>
                    <td className="num">{inr(p.selling_price)}</td>
                    <td className="num">{p.reorder_level}</td>
                    <td className="num">
                      <span className={`badge ${statusBadge(p.status)}`}>{p.stock}</span>
                    </td>
                    <td>{p.has_embedding ? <span className="badge green">384-d</span> : <span className="badge grey">none</span>}</td>
                    <td className="num">
                      <button
                        className="small secondary"
                        onClick={() =>
                          setEdit({
                            id: p.product_id,
                            mrp: p.mrp,
                            sellingPrice: p.selling_price,
                            reorderLevel: p.reorder_level,
                            aliases: p.aliases,
                          })
                        }
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                )
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
