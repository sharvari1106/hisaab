-- =====================================================================
-- Hisaab : 01_schema.sql
-- Tables, keys, constraints and indexes (DDL: CREATE / ALTER)
-- Target: PostgreSQL 16 with the pgvector and pg_trgm extensions
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS vector;    -- semantic (embedding) search
CREATE EXTENSION IF NOT EXISTS pg_trgm;   -- fuzzy / typo-tolerant search

-- ---------- Enumerated types (domain integrity) ----------
CREATE TYPE user_role       AS ENUM ('admin', 'owner', 'staff', 'customer');
CREATE TYPE pay_mode        AS ENUM ('cash', 'upi', 'credit');
CREATE TYPE ledger_kind     AS ENUM ('debit', 'credit');      -- debit = customer owes more, credit = customer paid
CREATE TYPE movement_reason AS ENUM ('sale', 'purchase', 'adjustment', 'expired');

-- ---------- SHOPS ----------
CREATE TABLE shops (
    shop_id     SERIAL PRIMARY KEY,
    name        VARCHAR(120) NOT NULL CHECK (length(trim(name)) >= 2),
    address     TEXT,
    phone       VARCHAR(10) CHECK (phone ~ '^[6-9][0-9]{9}$'),
    gstin       VARCHAR(15) UNIQUE
                CHECK (gstin IS NULL OR gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$'),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- CUSTOMERS (people who buy on credit / udhaar) ----------
CREATE TABLE customers (
    customer_id     SERIAL PRIMARY KEY,
    shop_id         INT NOT NULL REFERENCES shops(shop_id) ON DELETE CASCADE,
    name            VARCHAR(100) NOT NULL CHECK (length(trim(name)) >= 2),
    phone           VARCHAR(10) NOT NULL CHECK (phone ~ '^[6-9][0-9]{9}$'),
    address         TEXT,
    credit_limit    NUMERIC(10,2) NOT NULL DEFAULT 2000 CHECK (credit_limit BETWEEN 0 AND 100000),
    current_balance NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (current_balance >= 0),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_customer_phone_per_shop UNIQUE (shop_id, phone)
);

-- ---------- USERS (login accounts for every role) ----------
CREATE TABLE users (
    user_id       SERIAL PRIMARY KEY,
    name          VARCHAR(100) NOT NULL,
    phone         VARCHAR(10) NOT NULL UNIQUE CHECK (phone ~ '^[6-9][0-9]{9}$'),
    password_hash TEXT NOT NULL,
    role          user_role NOT NULL,
    shop_id       INT REFERENCES shops(shop_id) ON DELETE CASCADE,
    customer_id   INT UNIQUE REFERENCES customers(customer_id) ON DELETE CASCADE,
    is_active     BOOLEAN NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- every role is tied to the right scope
    CONSTRAINT chk_user_scope CHECK (
        (role = 'admin'              AND shop_id IS NULL     AND customer_id IS NULL) OR
        (role IN ('owner', 'staff')  AND shop_id IS NOT NULL AND customer_id IS NULL) OR
        (role = 'customer'           AND shop_id IS NOT NULL AND customer_id IS NOT NULL)
    )
);

-- shops <-> users is circular (a shop has an owner, a user belongs to a shop),
-- so the owner FK is added afterwards with ALTER TABLE.
ALTER TABLE shops ADD COLUMN owner_id INT;
ALTER TABLE shops ADD CONSTRAINT fk_shops_owner
    FOREIGN KEY (owner_id) REFERENCES users(user_id) ON DELETE SET NULL;

-- ---------- CATALOG ----------
CREATE TABLE categories (
    category_id SERIAL PRIMARY KEY,
    name        VARCHAR(60) NOT NULL UNIQUE
);

CREATE TABLE products (
    product_id    SERIAL PRIMARY KEY,
    shop_id       INT NOT NULL REFERENCES shops(shop_id) ON DELETE CASCADE,
    category_id   INT REFERENCES categories(category_id) ON DELETE SET NULL,
    name          VARCHAR(150) NOT NULL CHECK (length(trim(name)) >= 2),
    brand         VARCHAR(80),
    size_label    VARCHAR(30),                       -- e.g. '500 ml', '1 kg'
    unit          VARCHAR(10) NOT NULL DEFAULT 'pcs'
                  CHECK (unit IN ('pcs', 'pack', 'kg', 'g', 'l', 'ml', 'dozen')),
    mrp           NUMERIC(10,2) NOT NULL CHECK (mrp > 0),
    selling_price NUMERIC(10,2) NOT NULL CHECK (selling_price > 0),
    reorder_level INT NOT NULL DEFAULT 5 CHECK (reorder_level >= 0),
    is_active     BOOLEAN NOT NULL DEFAULT TRUE,
    search_doc    TSVECTOR,                          -- maintained by trigger (full-text search)
    embedding     VECTOR(384),                       -- multilingual sentence embedding
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_price_not_above_mrp CHECK (selling_price <= mrp),  -- illegal to sell above MRP in India
    CONSTRAINT uq_product_per_shop UNIQUE (shop_id, name, size_label)
);

-- local-language / slang names: "doodh", "paal", "maggi" ...
CREATE TABLE product_aliases (
    alias_id   SERIAL PRIMARY KEY,
    product_id INT NOT NULL REFERENCES products(product_id) ON DELETE CASCADE,
    alias      VARCHAR(80) NOT NULL CHECK (length(trim(alias)) >= 2),
    language   VARCHAR(5) NOT NULL DEFAULT 'en' CHECK (language IN ('en', 'hi', 'ta', 'kn', 'te', 'other'))
);

-- ---------- PURCHASING / STOCK ----------
CREATE TABLE suppliers (
    supplier_id SERIAL PRIMARY KEY,
    shop_id     INT NOT NULL REFERENCES shops(shop_id) ON DELETE CASCADE,
    name        VARCHAR(120) NOT NULL,
    phone       VARCHAR(10) CHECK (phone ~ '^[6-9][0-9]{9}$'),
    CONSTRAINT uq_supplier_per_shop UNIQUE (shop_id, name)
);

CREATE TABLE purchases (
    purchase_id         SERIAL PRIMARY KEY,
    shop_id             INT NOT NULL REFERENCES shops(shop_id) ON DELETE CASCADE,
    supplier_id         INT NOT NULL REFERENCES suppliers(supplier_id),
    supplier_invoice_no VARCHAR(40) NOT NULL,
    purchase_date       DATE NOT NULL DEFAULT current_date,
    total_amount        NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
    created_by          INT REFERENCES users(user_id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_supplier_invoice UNIQUE (supplier_id, supplier_invoice_no)  -- same bill can't be entered twice
);

-- each delivery of a product is a batch with its own cost and expiry (enables FEFO)
CREATE TABLE batches (
    batch_id      SERIAL PRIMARY KEY,
    product_id    INT NOT NULL REFERENCES products(product_id) ON DELETE CASCADE,
    purchase_id   INT REFERENCES purchases(purchase_id) ON DELETE SET NULL,
    batch_no      VARCHAR(40),
    mfg_date      DATE,
    expiry_date   DATE,
    cost_price    NUMERIC(10,2) NOT NULL CHECK (cost_price >= 0),
    qty_received  INT NOT NULL CHECK (qty_received > 0),
    qty_remaining INT NOT NULL CHECK (qty_remaining >= 0),
    received_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_qty_remaining CHECK (qty_remaining <= qty_received),
    CONSTRAINT chk_dates CHECK (expiry_date IS NULL OR mfg_date IS NULL OR expiry_date > mfg_date)
);

-- ---------- SALES ----------
CREATE TABLE invoices (
    invoice_id   SERIAL PRIMARY KEY,
    shop_id      INT NOT NULL REFERENCES shops(shop_id) ON DELETE CASCADE,
    customer_id  INT REFERENCES customers(customer_id),
    staff_id     INT NOT NULL REFERENCES users(user_id),
    payment_mode pay_mode NOT NULL,
    subtotal     NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
    discount     NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (discount >= 0),
    total        NUMERIC(12,2) NOT NULL DEFAULT 0,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_credit_needs_customer CHECK (payment_mode <> 'credit' OR customer_id IS NOT NULL),
    CONSTRAINT chk_discount_le_subtotal CHECK (discount <= subtotal),
    CONSTRAINT chk_total CHECK (total = subtotal - discount)
);

CREATE TABLE invoice_items (
    invoice_item_id SERIAL PRIMARY KEY,
    invoice_id      INT NOT NULL REFERENCES invoices(invoice_id) ON DELETE CASCADE,
    product_id      INT NOT NULL REFERENCES products(product_id),
    batch_id        INT NOT NULL REFERENCES batches(batch_id),
    qty             INT NOT NULL CHECK (qty > 0),
    unit_price      NUMERIC(10,2) NOT NULL CHECK (unit_price > 0),
    unit_cost       NUMERIC(10,2) NOT NULL CHECK (unit_cost >= 0),
    line_total      NUMERIC(12,2) GENERATED ALWAYS AS (qty * unit_price) STORED
);

-- ---------- MONEY: payments + immutable ledger ----------
CREATE TABLE payments (
    payment_id  SERIAL PRIMARY KEY,
    shop_id     INT NOT NULL REFERENCES shops(shop_id) ON DELETE CASCADE,
    customer_id INT NOT NULL REFERENCES customers(customer_id) ON DELETE RESTRICT,
    amount      NUMERIC(12,2) NOT NULL CHECK (amount > 0),
    mode        pay_mode NOT NULL CHECK (mode <> 'credit'),
    received_by INT REFERENCES users(user_id),
    note        TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE ledger_entries (
    entry_id      BIGSERIAL PRIMARY KEY,
    customer_id   INT NOT NULL REFERENCES customers(customer_id) ON DELETE RESTRICT,
    kind          ledger_kind NOT NULL,
    amount        NUMERIC(12,2) NOT NULL CHECK (amount > 0),
    balance_after NUMERIC(12,2) NOT NULL CHECK (balance_after >= 0),  -- set by trigger
    invoice_id    INT REFERENCES invoices(invoice_id),
    payment_id    INT REFERENCES payments(payment_id),
    note          TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- a debit always comes from an invoice, a credit always from a payment
    CONSTRAINT chk_ledger_source CHECK (
        (kind = 'debit'  AND invoice_id IS NOT NULL AND payment_id IS NULL) OR
        (kind = 'credit' AND payment_id IS NOT NULL AND invoice_id IS NULL)
    )
);

-- ---------- AUDIT OF STOCK + ALERTS ----------
CREATE TABLE stock_movements (
    movement_id BIGSERIAL PRIMARY KEY,
    batch_id    INT NOT NULL REFERENCES batches(batch_id) ON DELETE CASCADE,
    change_qty  INT NOT NULL CHECK (change_qty <> 0),
    reason      movement_reason NOT NULL,
    ref_id      INT,                  -- invoice_id / purchase_id depending on reason
    created_by  INT REFERENCES users(user_id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE alerts (
    alert_id    SERIAL PRIMARY KEY,
    shop_id     INT NOT NULL REFERENCES shops(shop_id) ON DELETE CASCADE,
    product_id  INT NOT NULL REFERENCES products(product_id) ON DELETE CASCADE,
    kind        VARCHAR(20) NOT NULL CHECK (kind IN ('low_stock', 'expiry')),
    message     TEXT NOT NULL,
    is_resolved BOOLEAN NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =====================================================================
-- INDEXES
-- =====================================================================
-- B-tree: frequent filters / sorts
CREATE INDEX idx_invoices_shop_date   ON invoices (shop_id, created_at DESC);
CREATE INDEX idx_invoice_items_inv    ON invoice_items (invoice_id);
CREATE INDEX idx_invoice_items_prod   ON invoice_items (product_id);
CREATE INDEX idx_ledger_customer_date ON ledger_entries (customer_id, created_at);
CREATE INDEX idx_payments_customer    ON payments (customer_id, created_at);
CREATE INDEX idx_products_shop        ON products (shop_id) WHERE is_active;
CREATE INDEX idx_customers_name_lower ON customers (shop_id, lower(name));            -- expression index

-- Partial index: only batches that still have stock, ordered for FEFO picking
CREATE INDEX idx_batches_fefo ON batches (product_id, expiry_date NULLS LAST, batch_id)
    WHERE qty_remaining > 0;

-- Unique expression index: no duplicate alias (case-insensitive) for one product
CREATE UNIQUE INDEX uq_alias_per_product ON product_aliases (product_id, lower(alias));

-- Partial unique index: at most one OPEN alert of each kind per product
CREATE UNIQUE INDEX uq_open_alert ON alerts (product_id, kind) WHERE NOT is_resolved;

-- GIN: full-text search on product name + brand + aliases
CREATE INDEX idx_products_search_doc ON products USING GIN (search_doc);

-- GIN trigram: typo-tolerant matching ("parel g" -> "Parle-G")
CREATE INDEX idx_products_name_trgm ON products USING GIN (name gin_trgm_ops);
CREATE INDEX idx_aliases_trgm       ON product_aliases USING GIN (alias gin_trgm_ops);

-- HNSW: approximate nearest-neighbour search on embeddings (cosine distance)
CREATE INDEX idx_products_embedding ON products USING hnsw (embedding vector_cosine_ops);
