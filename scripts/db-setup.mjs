// Creates (or re-creates) the whole PostgreSQL schema.
//   npm run db:setup
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const FILES = ['00_reset.sql', '01_schema.sql', '02_functions_triggers.sql', '03_views.sql'];

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set. Copy .env.example to .env first.');
  process.exit(1);
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL, options: '-c timezone=Asia/Kolkata' });
client.on('notice', () => {}); // "does not exist, skipping" noise from DROP IF EXISTS

await client.connect();
try {
  const ext = await client.query(
    "SELECT name FROM pg_available_extensions WHERE name IN ('vector', 'pg_trgm')"
  );
  const have = ext.rows.map((r) => r.name);
  if (!have.includes('vector')) {
    throw new Error(
      'The pgvector extension is not installed on this PostgreSQL server.\n' +
        '  Easiest fix: use the Docker database (npm run db:up), which ships with pgvector.\n' +
        '  Or install it: https://github.com/pgvector/pgvector#installation'
    );
  }
  for (const f of FILES) {
    process.stdout.write(`running sql/${f} ... `);
    await client.query(fs.readFileSync(path.join('sql', f), 'utf8'));
    console.log('ok');
  }
  const t = await client.query(
    "SELECT COUNT(*) FILTER (WHERE table_type = 'BASE TABLE') AS tables, COUNT(*) FILTER (WHERE table_type = 'VIEW') AS views FROM information_schema.tables WHERE table_schema = 'public'"
  );
  console.log(`\nSchema ready: ${t.rows[0].tables} tables, ${t.rows[0].views} views.`);
  console.log('Next: npm run db:seed');
} catch (e) {
  console.error(`\nFAILED: ${e.message}`);
  process.exitCode = 1;
} finally {
  await client.end();
}
