# Hisaab: smart khata for kirana stores

Billing, udhaar (credit) ledger and batch-wise inventory for neighbourhood grocery stores. It has multilingual hybrid search (full-text + fuzzy + **vector**), database-enforced credit limits, FEFO stock with expiry, OCR'd supplier-bill matching, and credit-risk scoring.

**Stack:** Next.js 15 · PostgreSQL 16 + **pgvector** + pg\_trgm · MongoDB 7 · transformers.js (local embeddings) · tesseract.js (OCR)

> DBMS Level 3 project. Full write-up: \[`docs/PROJECT\_REPORT.md`](docs/PROJECT\_REPORT.md) · ER diagram: \[`docs/er-diagram.png`](docs/er-diagram.png)

&#x20;  > Author: Sharvari Naik · PES University · \[github.com/sharvari1106/hisaab](https://github.com/sharvari1106/hisaab)

\---

## Quick start

**Requirements:** Node.js 20.6+ and Docker Desktop.

```bash
# 1. databases (PostgreSQL with pgvector on port 5433, MongoDB on 27017)
docker compose up -d

# 2. configuration
cp .env.example .env          # Windows: copy .env.example .env
#    then edit JWT\_SECRET to any random string of 32+ characters

# 3. install, create schema, load demo data, compute embeddings
npm install
npm run setup                 # = db:setup + db:seed + db:embed

# 4. run
npm run dev                   # open http://localhost:3000
```

The first `db:embed` downloads the embedding model (\~120 MB) once. If you are offline, set `EMBEDDINGS\_DISABLED=1` in `.env`; search still works with text and fuzzy matching.

### Demo accounts (password `password123`)

|Role|Mobile|Sees|
|-|-|-|
|Owner|9876543210|everything for the shop|
|Staff|9876543211|billing + inventory|
|Customer|9845012345|own khata (portal)|
|Platform admin|9999900000|shop onboarding|

The login page has one-click buttons that fill these in.

### Without Docker

Install PostgreSQL 16 with the [pgvector extension](https://github.com/pgvector/pgvector#installation) and (optionally) MongoDB. Then put your connection strings in `.env`:

```
DATABASE\_URL=postgres://USER:PASSWORD@localhost:5432/hisaab
MONGODB\_URI=mongodb://localhost:27017
```

MongoDB is optional: without it the app works, and only the activity log, product attributes and heatmap are skipped.

\---

## npm scripts

|Script|What it does|
|-|-|
|`npm run db:up`|`docker compose up -d`|
|`npm run db:setup`|drop + recreate the whole schema (`sql/00`–`03`)|
|`npm run db:seed`|demo shop, 44 products, 10 customers, 30 days of simulated sales (through the real functions), MongoDB back-fill|
|`npm run db:embed`|compute 384-d product embeddings and print a semantic-search demo|
|`npm run db:test`|run the 27 database tests (`tests/db\_tests.sql`, rolled back afterwards)|
|`npm run db:queries`|run the 19 annotated "important queries" (`sql/05\_important\_queries.sql`)|
|`npm run dev` / `build` / `start`|Next.js|

With Docker you can also use psql directly:

```bash
docker exec -it hisaab-postgres psql -U hisaab -f /tests/db\_tests.sql
docker exec -it hisaab-postgres psql -U hisaab -f /sql/05\_important\_queries.sql
docker exec -it hisaab-postgres psql -U hisaab -f /sql/04\_alter\_drop\_demo.sql
```

\---

## What to demo

1. **Billing search:** type `doodh`, `paal`, `thengai ennai`, `magi noodels`, `colgat`. Each result shows whether it matched by *text*, *fuzzy* or *semantic*.
2. **Out of stock:** click a product marked OUT to get vector-similar substitutes.
3. **Credit limit:** choose *Udhaar*, pick **Suresh Gowda** (₹1900 of ₹2000 used), and bill over ₹100. The database refuses it.
4. **Race condition:** open two windows (owner + staff), put the same low-stock item in both carts, and click *Collect* in both. One succeeds; the other gets "INSUFFICIENT\_STOCK".
5. **Bill scan:** *Scan supplier bill* → *Use sample bill* → *Match items* → *Save stock-in*.
6. **Khata:** open a HIGH-risk customer to see the statement, monthly trend, record a payment, and send a WhatsApp reminder.
7. **Reports:** KPIs, 14-day chart, MongoDB busy-hours heatmap, reorder forecast, and a materialized-view *REFRESH*.
8. **Integrity:** add a product priced above MRP, or a duplicate supplier bill number. The constraints answer.

\---

## Project structure

```
hisaab/
├── sql/
│   ├── 00\_reset.sql                 DROP everything
│   ├── 01\_schema.sql                types, 15 tables, constraints, ALTER, indexes (GIN, trigram, HNSW, partial)
│   ├── 02\_functions\_triggers.sql    fn\_process\_sale, sp\_record\_payment, triggers, hybrid search
│   ├── 03\_views.sql                 views (risk score, reorder forecast …) + materialized view
│   ├── 04\_alter\_drop\_demo.sql       ALTER / DROP demonstration
│   ├── 05\_important\_queries.sql     19 queries by syllabus unit + EXPLAIN ANALYZE
│   └── seed.sql                     demo data (simulated trading)
├── tests/db\_tests.sql               27 database test cases
├── app/
│   ├── login/                       login page
│   ├── (app)/                       pages behind login: billing, inventory, products, customers,
│   │                                bill-scan, reports, staff, my (customer), admin
│   └── api/                         Route Handlers = backend API layer
├── components/                      Shell (nav), Receipt, StockInForm
├── lib/
│   ├── db.js                        pg pool + withTransaction (retry on deadlock)
│   ├── mongo.js                     MongoDB client, indexes, activity logging
│   ├── embeddings.js                transformers.js multilingual embeddings
│   ├── analytics.js                 MongoDB aggregation pipelines
│   ├── session.js / api.js          JWT sessions, role guard, PostgreSQL error mapping
│   ├── validate.js                  input validation
│   └── billparser.js                supplier-bill text → line items
├── middleware.js                    page-level role-based access control
├── scripts/                         db-setup, seed, embed, run-sql
├── docs/                            PROJECT\_REPORT.md, er-diagram.png, architecture.png
└── docker-compose.yml
```

\---

## Putting it on GitHub

```bash
git init
git add .
git commit -m "Initial schema, API and UI"
git branch -M main
git remote add origin https://github.com/<you>/hisaab.git
git push -u origin main
```

`.env` is git-ignored, so double-check with `git status` that it is not listed before pushing. The brief asks for commits that show your own work, so commit in small steps as you customise and extend the project (for example "Add WhatsApp reminder", "Tune risk score weights") rather than in one big push.

\---

## Security notes

* Credentials live only in `.env` (git-ignored). `.env.example` documents them.
* Passwords are hashed with bcrypt. Sessions are HS256 JWTs in an `httpOnly`, `sameSite=lax` cookie.
* Roles are checked twice: `middleware.js` for pages and `requireUser()` in every API route.
* Every query is parameterised (`$1, $2 …`); there is no SQL string concatenation.
* Every query is scoped to the logged-in user's `shop\_id`, and customers only ever see their own `customer\_id`.

## Troubleshooting

|Problem|Fix|
|-|-|
|`pgvector extension is not installed`|Use the Docker database, or install pgvector for your PostgreSQL|
|`JWT\_SECRET must be set …`|Set a 32+ character `JWT\_SECRET` in `.env` and restart `npm run dev`|
|Port 5433 already used|Change the left side of `5433:5432` in `docker-compose.yml` and the port in `DATABASE\_URL`|
|"Database already has data" on seed|`npm run db:setup` first (it resets everything)|
|Search shows "semantic search off"|Run `npm run db:embed` (needs internet once)|
|Dates look wrong in reports|The app uses Asia/Kolkata; keep `TZ`/`PGTZ` in `docker-compose.yml`|



