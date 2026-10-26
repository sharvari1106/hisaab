// Runs a .sql file through node-postgres so you don't need psql installed.
//   node --env-file=.env scripts/run-sql.mjs tests/db_tests.sql
// Understands the two psql meta-commands used in this repo:
//   \echo '...'  -> printed as a heading      other \commands -> ignored
import fs from 'node:fs';
import pg from 'pg';

const file = process.argv[2];
if (!file) {
  console.error('usage: node scripts/run-sql.mjs <file.sql>');
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set. Copy .env.example to .env first.');
  process.exit(1);
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL, options: '-c timezone=Asia/Kolkata' });
client.on('notice', (n) => console.log(`  ${n.severity === 'NOTICE' ? '' : n.severity + ': '}${n.message}`));

// split the file into chunks separated by \echo lines
const chunks = [];
let current = [];
for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
  const trimmed = line.trim();
  if (trimmed.startsWith('\\echo')) {
    chunks.push({ sql: current.join('\n') });
    current = [];
    chunks.push({ echo: trimmed.replace(/^\\echo\s*/, '').replace(/^'|'$/g, '') });
  } else if (trimmed.startsWith('\\')) {
    // \set, \pset ... are psql-only
  } else {
    current.push(line);
  }
}
chunks.push({ sql: current.join('\n') });

function printResult(r) {
  if (!r || r.command !== 'SELECT' && r.command !== 'EXPLAIN' && !(r.rows && r.rows.length && r.fields?.length)) return;
  if (!r.rows.length) {
    console.log('  (0 rows)');
    return;
  }
  console.table(r.rows.slice(0, 40));
  if (r.rows.length > 40) console.log(`  ... ${r.rows.length - 40} more rows`);
}

await client.connect();
try {
  for (const c of chunks) {
    if (c.echo !== undefined) {
      console.log(`\n${c.echo}`);
      continue;
    }
    if (!c.sql.trim()) continue;
    const res = await client.query(c.sql);
    (Array.isArray(res) ? res : [res]).forEach(printResult);
  }
} catch (e) {
  console.error(`\nERROR: ${e.message}`);
  process.exitCode = 1;
} finally {
  await client.end();
}
