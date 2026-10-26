-- =====================================================================
-- Hisaab : database test suite
-- Run:  psql "$DATABASE_URL" -f tests/db_tests.sql
-- Everything runs inside one transaction that is ROLLED BACK at the end,
-- so your real data is never touched. Each test prints PASS or FAIL.
-- =====================================================================
\set ON_ERROR_STOP on
\set QUIET on
SET client_min_messages = notice;
BEGIN;

-- ---------- fixture ----------
CREATE TEMP TABLE fx (k TEXT PRIMARY KEY, v INT) ON COMMIT DROP;

DO $$
DECLARE s INT; o INT; c INT; c2 INT; p_milk INT; p_soap INT; p_pricey INT; sup INT;
BEGIN
    INSERT INTO shops (name, phone) VALUES ('Test Kirana', '9000000001') RETURNING shop_id INTO s;
    INSERT INTO users (name, phone, password_hash, role, shop_id)
         VALUES ('Test Owner', '9000000002', 'x', 'owner', s) RETURNING user_id INTO o;
    INSERT INTO customers (shop_id, name, phone, credit_limit) VALUES (s, 'Ravi', '9000000003', 500) RETURNING customer_id INTO c;
    INSERT INTO customers (shop_id, name, phone, credit_limit) VALUES (s, 'Meena', '9000000004', 5000) RETURNING customer_id INTO c2;
    INSERT INTO categories (name) VALUES ('Test Dairy') ON CONFLICT DO NOTHING;

    INSERT INTO products (shop_id, name, brand, size_label, mrp, selling_price, reorder_level, category_id)
         VALUES (s, 'Taaza Toned Milk', 'Amul', '500 ml', 28, 27, 5, (SELECT category_id FROM categories WHERE name = 'Test Dairy'))
      RETURNING product_id INTO p_milk;
    INSERT INTO product_aliases (product_id, alias, language) VALUES (p_milk, 'doodh', 'hi'), (p_milk, 'paal', 'ta');
    INSERT INTO products (shop_id, name, brand, size_label, mrp, selling_price, reorder_level)
         VALUES (s, 'Lifebuoy Soap', 'HUL', '100 g', 40, 38, 2) RETURNING product_id INTO p_soap;
    INSERT INTO products (shop_id, name, size_label, mrp, selling_price)
         VALUES (s, 'Basmati Rice', '5 kg', 600, 550) RETURNING product_id INTO p_pricey;

    INSERT INTO suppliers (shop_id, name) VALUES (s, 'Test Distributor') RETURNING supplier_id INTO sup;

    -- milk: an OLD batch expiring soon and a FRESH batch -> FEFO must use the old one first
    INSERT INTO batches (product_id, batch_no, expiry_date, cost_price, qty_received, qty_remaining)
         VALUES (p_milk, 'FRESH', current_date + 10, 24, 20, 20),
                (p_milk, 'OLD',   current_date + 2,  24, 5,  5),
                (p_milk, 'GONE',  current_date - 1,  24, 3,  3);   -- already expired
    INSERT INTO batches (product_id, batch_no, cost_price, qty_received, qty_remaining) VALUES (p_soap, 'S1', 30, 10, 10);
    INSERT INTO batches (product_id, batch_no, cost_price, qty_received, qty_remaining) VALUES (p_pricey, 'R1', 480, 10, 10);

    INSERT INTO fx VALUES ('shop', s), ('owner', o), ('ravi', c), ('meena', c2),
                          ('milk', p_milk), ('soap', p_soap), ('rice', p_pricey), ('supplier', sup);
END $$;

CREATE OR REPLACE FUNCTION pg_temp.id(k TEXT) RETURNS INT LANGUAGE sql AS $$ SELECT v FROM fx WHERE fx.k = $1 $$;
CREATE OR REPLACE FUNCTION pg_temp.ok(name TEXT, cond BOOLEAN) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
    IF cond THEN RAISE NOTICE 'PASS  %', name; ELSE RAISE NOTICE 'FAIL  %', name; END IF;
END $$;

-- ---------- T01: cash sale uses FEFO (oldest expiry first) and skips expired stock ----------
DO $$
DECLARE inv INT;
BEGIN
    inv := fn_process_sale(pg_temp.id('shop'), pg_temp.id('owner'), NULL, 'cash',
                           jsonb_build_array(jsonb_build_object('product_id', pg_temp.id('milk'), 'qty', 7)));
    PERFORM pg_temp.ok('T01 FEFO: OLD batch emptied first',
        (SELECT qty_remaining FROM batches WHERE batch_no = 'OLD'   AND product_id = pg_temp.id('milk')) = 0
    AND (SELECT qty_remaining FROM batches WHERE batch_no = 'FRESH' AND product_id = pg_temp.id('milk')) = 18
    AND (SELECT qty_remaining FROM batches WHERE batch_no = 'GONE'  AND product_id = pg_temp.id('milk')) = 3);
    PERFORM pg_temp.ok('T02 invoice total computed from DB prices (7 x 27 = 189)',
        (SELECT total FROM invoices WHERE invoice_id = inv) = 189);
    PERFORM pg_temp.ok('T03 stock movement audit rows written',
        (SELECT SUM(change_qty) FROM stock_movements WHERE reason = 'sale' AND ref_id = inv) = -7);
END $$;

-- ---------- T04: overselling is impossible and the failed sale leaves no trace ----------
DO $$
DECLARE before_inv BIGINT := (SELECT COUNT(*) FROM invoices);
BEGIN
    BEGIN
        PERFORM fn_process_sale(pg_temp.id('shop'), pg_temp.id('owner'), NULL, 'cash',
            jsonb_build_array(jsonb_build_object('product_id', pg_temp.id('soap'), 'qty', 2),
                              jsonb_build_object('product_id', pg_temp.id('milk'), 'qty', 500)));
        PERFORM pg_temp.ok('T04 insufficient stock rejected', FALSE);
    EXCEPTION WHEN OTHERS THEN
        PERFORM pg_temp.ok('T04 insufficient stock rejected: ' || left(SQLERRM, 60), SQLERRM LIKE 'INSUFFICIENT_STOCK%');
    END;
    PERFORM pg_temp.ok('T05 atomic rollback: no invoice and soap stock untouched',
        (SELECT COUNT(*) FROM invoices) = before_inv
    AND (SELECT qty_remaining FROM batches WHERE product_id = pg_temp.id('soap')) = 10);
END $$;

-- ---------- T06: credit sale updates balance via the ledger trigger ----------
DO $$
DECLARE inv INT;
BEGIN
    inv := fn_process_sale(pg_temp.id('shop'), pg_temp.id('owner'), pg_temp.id('ravi'), 'credit',
                           jsonb_build_array(jsonb_build_object('product_id', pg_temp.id('soap'), 'qty', 5)));   -- 190
    PERFORM pg_temp.ok('T06 credit sale: balance 190 and ledger balance_after 190',
        (SELECT current_balance FROM customers WHERE customer_id = pg_temp.id('ravi')) = 190
    AND (SELECT balance_after FROM ledger_entries WHERE invoice_id = inv) = 190);
END $$;

-- ---------- T07: credit limit enforced (Ravi: limit 500, owes 190, tries 550) ----------
DO $$
BEGIN
    BEGIN
        PERFORM fn_process_sale(pg_temp.id('shop'), pg_temp.id('owner'), pg_temp.id('ravi'), 'credit',
                                jsonb_build_array(jsonb_build_object('product_id', pg_temp.id('rice'), 'qty', 1)));
        PERFORM pg_temp.ok('T07 credit limit enforced', FALSE);
    EXCEPTION WHEN OTHERS THEN
        PERFORM pg_temp.ok('T07 credit limit enforced', SQLERRM LIKE 'CREDIT_LIMIT_EXCEEDED%');
    END;
    PERFORM pg_temp.ok('T08 rejected credit sale did not change balance or rice stock',
        (SELECT current_balance FROM customers WHERE customer_id = pg_temp.id('ravi')) = 190
    AND (SELECT qty_remaining FROM batches WHERE product_id = pg_temp.id('rice')) = 10);
END $$;

-- ---------- T09/T10: repayments ----------
DO $$
DECLARE pid INT;
BEGIN
    CALL sp_record_payment(pg_temp.id('shop'), pg_temp.id('ravi'), 100, 'upi', pg_temp.id('owner'), NULL, now(), pid);
    PERFORM pg_temp.ok('T09 payment reduces balance to 90',
        (SELECT current_balance FROM customers WHERE customer_id = pg_temp.id('ravi')) = 90 AND pid IS NOT NULL);
    BEGIN
        CALL sp_record_payment(pg_temp.id('shop'), pg_temp.id('ravi'), 1000, 'cash', pg_temp.id('owner'), NULL, now(), pid);
        PERFORM pg_temp.ok('T10 overpayment rejected', FALSE);
    EXCEPTION WHEN OTHERS THEN
        PERFORM pg_temp.ok('T10 overpayment rejected', SQLERRM LIKE 'OVERPAYMENT%');
    END;
END $$;

-- ---------- T11: ledger is append-only ----------
DO $$
BEGIN
    BEGIN
        UPDATE ledger_entries SET amount = 1 WHERE customer_id = pg_temp.id('ravi');
        PERFORM pg_temp.ok('T11 ledger UPDATE blocked', FALSE);
    EXCEPTION WHEN OTHERS THEN
        PERFORM pg_temp.ok('T11 ledger UPDATE blocked', SQLERRM LIKE 'LEDGER_IMMUTABLE%');
    END;
    BEGIN
        DELETE FROM customers WHERE customer_id = pg_temp.id('ravi');
        PERFORM pg_temp.ok('T12 customer with history cannot be deleted', FALSE);
    EXCEPTION WHEN foreign_key_violation THEN
        PERFORM pg_temp.ok('T12 customer with history cannot be deleted (FK RESTRICT)', TRUE);
    END;
END $$;

-- ---------- T13-T17: constraint validation at the database level ----------
DO $$
BEGIN
    BEGIN
        INSERT INTO products (shop_id, name, mrp, selling_price) VALUES (pg_temp.id('shop'), 'Overpriced', 10, 12);
        PERFORM pg_temp.ok('T13 selling price above MRP rejected', FALSE);
    EXCEPTION WHEN check_violation THEN PERFORM pg_temp.ok('T13 selling price above MRP rejected', TRUE); END;

    BEGIN
        INSERT INTO customers (shop_id, name, phone) VALUES (pg_temp.id('shop'), 'Bad Phone', '12345');
        PERFORM pg_temp.ok('T14 invalid phone rejected', FALSE);
    EXCEPTION WHEN check_violation THEN PERFORM pg_temp.ok('T14 invalid phone rejected', TRUE); END;

    BEGIN
        PERFORM fn_process_sale(pg_temp.id('shop'), pg_temp.id('owner'), NULL, 'credit',
                                jsonb_build_array(jsonb_build_object('product_id', pg_temp.id('soap'), 'qty', 1)));
        PERFORM pg_temp.ok('T15 credit sale without customer rejected', FALSE);
    EXCEPTION WHEN check_violation THEN PERFORM pg_temp.ok('T15 credit sale without customer rejected', TRUE); END;

    BEGIN
        PERFORM fn_process_sale(pg_temp.id('shop'), pg_temp.id('owner'), NULL, 'cash',
                                jsonb_build_array(jsonb_build_object('product_id', pg_temp.id('soap'), 'qty', 1)), 999);
        PERFORM pg_temp.ok('T16 discount larger than bill rejected', FALSE);
    EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ok('T16 discount larger than bill rejected', SQLERRM LIKE 'INVALID_DISCOUNT%'); END;

    BEGIN
        INSERT INTO purchases (shop_id, supplier_id, supplier_invoice_no) VALUES (pg_temp.id('shop'), pg_temp.id('supplier'), 'INV-1');
        INSERT INTO purchases (shop_id, supplier_id, supplier_invoice_no) VALUES (pg_temp.id('shop'), pg_temp.id('supplier'), 'INV-1');
        PERFORM pg_temp.ok('T17 same supplier bill entered twice rejected', FALSE);
    EXCEPTION WHEN unique_violation THEN PERFORM pg_temp.ok('T17 same supplier bill entered twice rejected', TRUE); END;
END $$;

-- ---------- T18: low-stock alert raised by trigger (soap: 10 - 5 = 5 > 2 ... sell 4 more -> 1) ----------
DO $$
BEGIN
    PERFORM fn_process_sale(pg_temp.id('shop'), pg_temp.id('owner'), NULL, 'upi',
                            jsonb_build_array(jsonb_build_object('product_id', pg_temp.id('soap'), 'qty', 4)));
    PERFORM pg_temp.ok('T18 low-stock alert raised automatically',
        EXISTS (SELECT 1 FROM alerts WHERE product_id = pg_temp.id('soap') AND kind = 'low_stock' AND NOT is_resolved));
END $$;

-- ---------- T19: purchase total + stock-in movement maintained by trigger; alert auto-resolves ----------
DO $$
DECLARE pur INT;
BEGIN
    INSERT INTO purchases (shop_id, supplier_id, supplier_invoice_no) VALUES (pg_temp.id('shop'), pg_temp.id('supplier'), 'INV-2')
    RETURNING purchase_id INTO pur;
    INSERT INTO batches (product_id, purchase_id, cost_price, qty_received, qty_remaining)
         VALUES (pg_temp.id('soap'), pur, 30, 12, 12);
    PERFORM pg_temp.ok('T19 purchase total = 360 and stock-in movement logged',
        (SELECT total_amount FROM purchases WHERE purchase_id = pur) = 360
    AND EXISTS (SELECT 1 FROM stock_movements WHERE reason = 'purchase' AND ref_id = pur AND change_qty = 12));
    PERFORM pg_temp.ok('T20 low-stock alert auto-resolved after restock',
        NOT EXISTS (SELECT 1 FROM alerts WHERE product_id = pg_temp.id('soap') AND kind = 'low_stock' AND NOT is_resolved));
END $$;

-- ---------- T21: expired stock write-off procedure ----------
DO $$
DECLARE nb INT; nu INT;
BEGIN
    CALL sp_write_off_expired(pg_temp.id('shop'), pg_temp.id('owner'), nb, nu);
    PERFORM pg_temp.ok('T21 expired batch written off (1 batch, 3 units)', nb = 1 AND nu = 3
        AND (SELECT qty_remaining FROM batches WHERE batch_no = 'GONE' AND product_id = pg_temp.id('milk')) = 0);
END $$;

-- ---------- T22-T23: search ----------
DO $$
BEGIN
    PERFORM pg_temp.ok('T22 full-text search finds milk by Hindi alias "doodh"',
        EXISTS (SELECT 1 FROM fn_hybrid_search(pg_temp.id('shop'), 'doodh') WHERE product_id = pg_temp.id('milk')));
    PERFORM pg_temp.ok('T23 fuzzy search survives a typo ("lifeboy")',
        (SELECT product_id FROM fn_hybrid_search(pg_temp.id('shop'), 'lifeboy') LIMIT 1) = pg_temp.id('soap'));
    PERFORM pg_temp.ok('T24 prefix search while typing ("taa")',
        EXISTS (SELECT 1 FROM fn_hybrid_search(pg_temp.id('shop'), 'taa') WHERE product_id = pg_temp.id('milk')));
END $$;

-- ---------- T25: views compute ----------
DO $$
BEGIN
    PERFORM pg_temp.ok('T25 v_product_stock: milk stock 18, expired 0 after write-off',
        (SELECT stock FROM v_product_stock WHERE product_id = pg_temp.id('milk')) = 18);
    PERFORM pg_temp.ok('T26 v_customer_risk returns a score for Ravi',
        (SELECT risk_score FROM v_customer_risk WHERE customer_id = pg_temp.id('ravi')) IS NOT NULL);
    PERFORM pg_temp.ok('T27 v_expiring_soon lists nothing for an emptied batch',
        NOT EXISTS (SELECT 1 FROM v_expiring_soon WHERE batch_no = 'OLD' AND product_id = pg_temp.id('milk')));
END $$;

ROLLBACK;
\echo 'Done. All test data rolled back.'
