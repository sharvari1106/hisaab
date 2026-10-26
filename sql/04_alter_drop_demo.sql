-- =====================================================================
-- Hisaab : 04_alter_drop_demo.sql
-- Demonstrates ALTER and DROP on a live schema (safe to run any time).
-- Real uses of ALTER in the project: shops.owner_id + fk_shops_owner (01_schema.sql)
-- =====================================================================

-- 1. Feature request: "remind customers on WhatsApp" -> add columns
ALTER TABLE customers ADD COLUMN IF NOT EXISTS whatsapp_opt_in BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS last_reminded_at TIMESTAMPTZ;

-- 2. Add a constraint after the fact (NOT VALID = don't scan old rows now, then VALIDATE)
ALTER TABLE customers DROP CONSTRAINT IF EXISTS chk_reminder_not_future;
ALTER TABLE customers ADD CONSTRAINT chk_reminder_not_future
    CHECK (last_reminded_at IS NULL OR last_reminded_at <= now() + INTERVAL '1 minute') NOT VALID;
ALTER TABLE customers VALIDATE CONSTRAINT chk_reminder_not_future;

-- 3. Change a column's type / default
ALTER TABLE products ALTER COLUMN reorder_level SET DEFAULT 6;
ALTER TABLE suppliers ALTER COLUMN name TYPE VARCHAR(150);

-- 4. Rename (and rename back) a column
ALTER TABLE suppliers RENAME COLUMN phone TO contact_phone;
ALTER TABLE suppliers RENAME COLUMN contact_phone TO phone;

-- 5. A scratch table to show DROP behaviour
CREATE TABLE IF NOT EXISTS tmp_price_history (
    id         SERIAL PRIMARY KEY,
    product_id INT REFERENCES products(product_id) ON DELETE CASCADE,
    old_price  NUMERIC(10,2),
    new_price  NUMERIC(10,2),
    changed_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tmp_price_history ON tmp_price_history (product_id);
CREATE OR REPLACE VIEW v_tmp_price_changes AS SELECT product_id, COUNT(*) AS changes FROM tmp_price_history GROUP BY product_id;

DROP INDEX IF EXISTS idx_tmp_price_history;             -- drop an index
ALTER TABLE tmp_price_history DROP COLUMN changed_at;    -- drop a column

-- plain DROP is refused because the view depends on the table (RESTRICT is the default)
DO $$
BEGIN
    EXECUTE 'DROP TABLE tmp_price_history';
EXCEPTION WHEN dependent_objects_still_exist THEN
    RAISE NOTICE 'DROP TABLE refused: %', SQLERRM;
END $$;

DROP TABLE tmp_price_history CASCADE;                    -- removes the table AND the dependent view

-- 6. Undo the demo columns so the schema matches the documentation again
ALTER TABLE customers DROP CONSTRAINT chk_reminder_not_future;
ALTER TABLE customers DROP COLUMN whatsapp_opt_in, DROP COLUMN last_reminded_at;
ALTER TABLE products ALTER COLUMN reorder_level SET DEFAULT 5;
ALTER TABLE suppliers ALTER COLUMN name TYPE VARCHAR(120);
