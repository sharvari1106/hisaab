// Supplier bill -> parsed lines -> each line matched to a catalogue product by hybrid/vector search.
// The raw scan and the matches are stored as one MongoDB document (structure differs per supplier).
import { handler, HttpError, readJson, requireUser } from '@/lib/api';
import { many } from '@/lib/db';
import { embed, toPgVector } from '@/lib/embeddings';
import { getMongo, logActivity } from '@/lib/mongo';
import { parseBillText } from '@/lib/billparser';
import { str } from '@/lib/validate';

export const POST = handler(async (request) => {
  const s = await requireUser(request, ['owner']);
  const b = await readJson(request);
  const text = str(b.text, 'Bill text', { min: 4, max: 20000 });
  const lines = parseBillText(text);
  if (!lines.length) throw new HttpError(400, 'No item lines found. Paste one item per line: name, quantity, rate.');

  const vectors = await embed(lines.map((l) => l.item)); // one batched model call for all lines
  const matched = [];
  for (let i = 0; i < lines.length; i++) {
    const candidates = await many(
      'SELECT product_id, name, size_label, selling_price, score, matched_by FROM fn_hybrid_search($1, $2, $3::vector, 3)',
      [s.shopId, lines[i].item, vectors ? toPgVector(vectors[i]) : null]
    );
    matched.push({ ...lines[i], candidates, productId: candidates[0]?.product_id ?? null });
  }

  let scanId = null;
  const db = await getMongo();
  if (db) {
    const res = await db.collection('bill_scans').insertOne({
      shopId: s.shopId,
      createdBy: s.uid,
      supplierId: b.supplierId || null,
      source: b.source === 'ocr' ? 'ocr' : 'paste',
      rawText: text,
      lines: matched.map((l) => ({
        raw: l.raw, item: l.item, qty: l.qty, rate: l.rate,
        match: l.candidates[0] ? { productId: l.candidates[0].product_id, name: l.candidates[0].name, score: l.candidates[0].score, by: l.candidates[0].matched_by } : null,
      })),
      matchedCount: matched.filter((l) => l.productId).length,
      status: 'matched',
      createdAt: new Date(),
    });
    scanId = res.insertedId.toString();
  }
  logActivity({ shopId: s.shopId, userId: s.uid, role: s.role, action: 'bill.scan', meta: { lines: matched.length, matched: matched.filter((l) => l.productId).length } });
  return { scanId, semantic: Boolean(vectors), lines: matched };
});
