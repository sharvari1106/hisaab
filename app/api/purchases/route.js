import { handler, HttpError, readJson, requireUser } from '@/lib/api';
import { many, withTransaction } from '@/lib/db';
import { getMongo, logActivity } from '@/lib/mongo';
import { date, id, num, str } from '@/lib/validate';
import { ObjectId } from 'mongodb';

// GET /api/purchases - recent stock deliveries
export const GET = handler(async (request) => {
  const s = await requireUser(request, ['owner', 'staff']);
  const purchases = await many(
    `SELECT pu.purchase_id, pu.supplier_invoice_no, pu.purchase_date, pu.total_amount, su.name AS supplier,
            COUNT(b.batch_id) AS lines, u.name AS created_by
       FROM purchases pu
       JOIN suppliers su ON su.supplier_id = pu.supplier_id
       LEFT JOIN batches b ON b.purchase_id = pu.purchase_id
       LEFT JOIN users u ON u.user_id = pu.created_by
      WHERE pu.shop_id = $1
      GROUP BY pu.purchase_id, su.name, u.name
      ORDER BY pu.created_at DESC
      LIMIT 30`,
    [s.shopId]
  );
  return { purchases };
});

// POST /api/purchases - stock-in: one supplier bill -> one purchase + one batch per line (single transaction)
export const POST = handler(async (request) => {
  const s = await requireUser(request, ['owner', 'staff']);
  const b = await readJson(request);
  const supplierId = id(b.supplierId, 'Supplier');
  const invoiceNo = str(b.invoiceNo, 'Supplier bill number', { max: 40 });
  const purchaseDate = date(b.purchaseDate, 'Purchase date') || new Date().toISOString().slice(0, 10);
  if (!Array.isArray(b.items) || !b.items.length) throw new HttpError(400, 'Add at least one item.');
  if (b.items.length > 100) throw new HttpError(400, 'Too many lines in one bill.');

  const items = b.items.map((it, i) => ({
    productId: id(it.productId, `Line ${i + 1} product`),
    qty: num(it.qty, `Line ${i + 1} quantity`, { min: 1, max: 100000, integer: true }),
    costPrice: num(it.costPrice, `Line ${i + 1} cost price`, { min: 0, max: 100000 }),
    batchNo: str(it.batchNo, `Line ${i + 1} batch`, { max: 40, optional: true }),
    mfgDate: date(it.mfgDate, `Line ${i + 1} mfg date`),
    expiryDate: date(it.expiryDate, `Line ${i + 1} expiry date`),
  }));

  const purchase = await withTransaction(async (c) => {
    const sup = await c.query('SELECT 1 FROM suppliers WHERE supplier_id = $1 AND shop_id = $2', [supplierId, s.shopId]);
    if (!sup.rowCount) throw new HttpError(400, 'Unknown supplier.');

    const { rows } = await c.query(
      `INSERT INTO purchases (shop_id, supplier_id, supplier_invoice_no, purchase_date, created_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING purchase_id`,
      [s.shopId, supplierId, invoiceNo, purchaseDate, s.uid]
    );
    const purchaseId = rows[0].purchase_id;

    for (const it of items) {
      // INSERT ... SELECT guarantees the product belongs to this shop (0 rows otherwise)
      const ins = await c.query(
        `INSERT INTO batches (product_id, purchase_id, batch_no, mfg_date, expiry_date, cost_price, qty_received, qty_remaining)
         SELECT p.product_id, $2, $3, $4, $5, $6, $7, $7
           FROM products p WHERE p.product_id = $1 AND p.shop_id = $8
         RETURNING batch_id`,
        [it.productId, purchaseId, it.batchNo, it.mfgDate, it.expiryDate, it.costPrice, it.qty, s.shopId]
      );
      if (!ins.rowCount) throw new HttpError(400, `Product ${it.productId} does not belong to this shop.`);
    }
    // total_amount was maintained by trigger batches_purchase_total
    const total = await c.query('SELECT purchase_id, total_amount FROM purchases WHERE purchase_id = $1', [purchaseId]);
    return total.rows[0];
  });

  if (b.scanId && /^[a-f0-9]{24}$/i.test(b.scanId)) {
    const db = await getMongo();
    await db?.collection('bill_scans').updateOne(
      { _id: new ObjectId(b.scanId), shopId: s.shopId },
      { $set: { status: 'applied', purchaseId: purchase.purchase_id, appliedAt: new Date() } }
    );
  }
  logActivity({
    shopId: s.shopId, userId: s.uid, role: s.role, action: 'stock.in', entity: 'purchase', entityId: purchase.purchase_id,
    meta: { total: purchase.total_amount, lines: items.length, fromScan: Boolean(b.scanId) },
  });
  return { purchase };
});
