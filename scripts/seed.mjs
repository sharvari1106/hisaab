// Loads demo data into PostgreSQL (sql/seed.sql) and back-fills MongoDB
// (activity logs for every past sale/payment/purchase + flexible product attributes).
//   npm run db:seed
import fs from 'node:fs';
import pg from 'pg';
import { MongoClient } from 'mongodb';
import { ensureIndexes } from '../lib/mongo.js';

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set. Copy .env.example to .env first.');
  process.exit(1);
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL, options: '-c timezone=Asia/Kolkata' });
client.on('notice', (n) => console.log('  ' + n.message));
await client.connect();

try {
  const { rows } = await client.query("SELECT to_regclass('public.shops') AS t");
  if (!rows[0].t) throw new Error('Schema not found. Run "npm run db:setup" first.');
  const { rows: c } = await client.query('SELECT COUNT(*)::INT AS n FROM shops');
  if (c[0].n > 0) throw new Error('Database already has data. Run "npm run db:setup" to reset it (drops everything), then seed again.');

  console.log('PostgreSQL: simulating 30 days of trading ...');
  await client.query(fs.readFileSync('sql/seed.sql', 'utf8'));

  if (!process.env.MONGODB_URI) {
    console.log('MONGODB_URI not set - skipping MongoDB back-fill.');
  } else {
    await seedMongo();
  }

  console.log('\nDone. Log in at http://localhost:3000 with any demo account (password: password123):');
  console.log('  owner 9876543210 | staff 9876543211 | customer 9845012345 | admin 9999900000');
  console.log('Next: npm run db:embed  (computes product vectors for semantic search)');
} catch (e) {
  console.error(`\nFAILED: ${e.message}`);
  process.exitCode = 1;
} finally {
  await client.end();
}

async function seedMongo() {
  let mongo;
  try {
    mongo = await MongoClient.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 3000 });
  } catch (e) {
    console.log(`MongoDB not reachable (${e.message}) - skipping back-fill. The app still works without it.`);
    return;
  }
  const db = mongo.db(process.env.MONGODB_DB || 'hisaab');
  for (const name of ['activity_logs', 'product_attributes', 'bill_scans']) {
    await db.collection(name).drop().catch(() => {});
  }
  await ensureIndexes(db);

  // 1. activity log for every historical event
  const sales = await client.query(
    `SELECT i.invoice_id, i.shop_id, i.staff_id, u.role, i.total, i.payment_mode, i.customer_id, i.created_at,
            COUNT(ii.*)::INT AS lines, SUM(ii.qty)::INT AS units
       FROM invoices i JOIN users u ON u.user_id = i.staff_id JOIN invoice_items ii ON ii.invoice_id = i.invoice_id
      GROUP BY i.invoice_id, u.role`
  );
  const payments = await client.query(
    `SELECT p.payment_id, p.shop_id, p.received_by, p.amount, p.mode, p.customer_id, p.created_at FROM payments p`
  );
  const purchases = await client.query(
    `SELECT purchase_id, shop_id, created_by, total_amount, created_at,
            (SELECT COUNT(*)::INT FROM batches b WHERE b.purchase_id = p.purchase_id) AS lines
       FROM purchases p`
  );
  const docs = [
    ...sales.rows.map((r) => ({
      shopId: r.shop_id, userId: r.staff_id, role: r.role, action: 'sale.create', entity: 'invoice', entityId: r.invoice_id,
      meta: { total: Number(r.total), mode: r.payment_mode, lines: r.lines, units: r.units, customerId: r.customer_id }, at: r.created_at,
    })),
    ...payments.rows.map((r) => ({
      shopId: r.shop_id, userId: r.received_by, role: 'owner', action: 'payment.record', entity: 'payment', entityId: r.payment_id,
      meta: { amount: Number(r.amount), mode: r.mode, customerId: r.customer_id }, at: r.created_at,
    })),
    ...purchases.rows.map((r) => ({
      shopId: r.shop_id, userId: r.created_by, role: 'owner', action: 'stock.in', entity: 'purchase', entityId: r.purchase_id,
      meta: { total: Number(r.total_amount), lines: r.lines, fromScan: false }, at: r.created_at,
    })),
  ];
  if (docs.length) await db.collection('activity_logs').insertMany(docs);

  // 2. flexible attributes - different keys for different kinds of product (why a document store fits)
  const products = await client.query(
    'SELECT p.product_id, p.shop_id, p.name, c.name AS category FROM products p LEFT JOIN categories c ON c.category_id = p.category_id'
  );
  const attrDocs = products.rows.map((p) => ({
    productId: p.product_id,
    shopId: p.shop_id,
    attributes: attributesFor(p.name, p.category),
    updatedAt: new Date(),
  }));
  if (attrDocs.length) await db.collection('product_attributes').insertMany(attrDocs);

  console.log(`MongoDB: ${docs.length} activity logs, ${attrDocs.length} product attribute documents.`);
  await mongo.close();
}

function attributesFor(name, category) {
  // drop keys that don't apply to this product
  return Object.fromEntries(Object.entries(rawAttributes(name, category)).filter(([, v]) => v !== undefined));
}

function rawAttributes(name, category) {
  const n = name.toLowerCase();
  switch (category) {
    case 'Dairy & Eggs':
      return { veg: !n.includes('egg'), storage: 'refrigerate', shelf_life_days: n.includes('butter') ? 120 : 7, fat_pct: n.includes('toned') ? 3 : undefined };
    case 'Bakery':
      return { veg: true, contains_gluten: true, shelf_life_days: n.includes('rusk') ? 90 : 5 };
    case 'Staples':
      return { veg: true, organic: false, origin: n.includes('basmati') ? 'Punjab' : n.includes('sona') ? 'Karnataka' : 'India', loose_available: !n.includes('oil') };
    case 'Spices':
      return { veg: true, heat_level: n.includes('chilli') ? 'hot' : 'mild', pack: 'pouch' };
    case 'Snacks':
      return { veg: true, flavour: n.includes('salted') ? 'salted' : n.includes('masala') ? 'masala' : 'classic', kids_favourite: n.includes('parle') || n.includes('good day') };
    case 'Beverages':
      return { veg: true, served: n.includes('tea') || n.includes('coffee') ? 'hot' : 'cold', caffeine: n.includes('cola') || n.includes('tea') || n.includes('coffee'), sugar_free: n.includes('water') };
    case 'Instant Food':
      return { veg: true, cooking_time_min: n.includes('noodles') ? 2 : 15, flavour: n.includes('masala') ? 'masala' : 'regular' };
    case 'Personal Care':
      return { skin_type: n.includes('soap') || n.includes('wash') ? 'all' : undefined, hair_care: n.includes('shampoo') || n.includes('oil'), fragrance: n.includes('lifebuoy') ? 'herbal' : 'mild' };
    case 'Household':
      return { hazard: n.includes('cleaner') || n.includes('mosquito') ? 'keep away from children' : 'none', form: n.includes('powder') ? 'powder' : n.includes('bar') ? 'bar' : 'liquid' };
    default:
      return {};
  }
}
