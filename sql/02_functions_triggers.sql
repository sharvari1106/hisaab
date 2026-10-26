-- =====================================================================
-- Hisaab : 02_functions_triggers.sql
-- Triggers, functions and stored procedures (business rules live in the DB)
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. FULL-TEXT SEARCH DOCUMENT
--    name and aliases weigh more (A) than brand (B) and category (C)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_build_search_doc(p_product_id INT, p_name TEXT, p_brand TEXT, p_category_id INT)
RETURNS TSVECTOR LANGUAGE sql STABLE AS $$
    SELECT setweight(to_tsvector('simple', coalesce(p_name, '')), 'A')
        || setweight(to_tsvector('simple', coalesce(
               (SELECT string_agg(alias, ' ') FROM product_aliases WHERE product_id = p_product_id), '')), 'A')
        || setweight(to_tsvector('simple', coalesce(p_brand, '')), 'B')
        || setweight(to_tsvector('simple', coalesce(
               (SELECT name FROM categories WHERE category_id = p_category_id), '')), 'C');
$$;

CREATE OR REPLACE FUNCTION trg_products_search_doc() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.search_doc := fn_build_search_doc(NEW.product_id, NEW.name, NEW.brand, NEW.category_id);
    RETURN NEW;
END $$;

CREATE TRIGGER products_search_doc
    BEFORE INSERT OR UPDATE OF name, brand, category_id ON products
    FOR EACH ROW EXECUTE FUNCTION trg_products_search_doc();

-- when aliases change, rebuild the parent product's search document
CREATE OR REPLACE FUNCTION trg_aliases_search_doc() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE v_pid INT := COALESCE(NEW.product_id, OLD.product_id);
BEGIN
    UPDATE products p
       SET search_doc = fn_build_search_doc(p.product_id, p.name, p.brand, p.category_id)
     WHERE p.product_id = v_pid;
    RETURN NULL;
END $$;

CREATE TRIGGER aliases_search_doc
    AFTER INSERT OR UPDATE OR DELETE ON product_aliases
    FOR EACH ROW EXECUTE FUNCTION trg_aliases_search_doc();

-- ---------------------------------------------------------------------
-- 2. LEDGER: enforce credit limit, prevent over-payment, keep balance in sync
--    The customer row is locked (FOR UPDATE) so two concurrent credit sales
--    for the same customer cannot both slip under the limit.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trg_ledger_apply() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
    v_balance NUMERIC(12,2);
    v_limit   NUMERIC(10,2);
    v_name    TEXT;
    v_new     NUMERIC(12,2);
BEGIN
    SELECT current_balance, credit_limit, name
      INTO v_balance, v_limit, v_name
      FROM customers WHERE customer_id = NEW.customer_id
       FOR UPDATE;

    IF NEW.kind = 'debit' THEN
        v_new := v_balance + NEW.amount;
        IF v_new > v_limit THEN
            RAISE EXCEPTION 'CREDIT_LIMIT_EXCEEDED: % owes Rs %, limit Rs %, this bill needs Rs % more credit',
                v_name, v_balance, v_limit, NEW.amount
                USING ERRCODE = 'P0001', HINT = 'Collect part payment in cash/UPI or raise the credit limit.';
        END IF;
    ELSE
        v_new := v_balance - NEW.amount;
        IF v_new < 0 THEN
            RAISE EXCEPTION 'OVERPAYMENT: % only owes Rs %, cannot accept Rs %', v_name, v_balance, NEW.amount
                USING ERRCODE = 'P0001';
        END IF;
    END IF;

    NEW.balance_after := v_new;
    UPDATE customers SET current_balance = v_new WHERE customer_id = NEW.customer_id;
    RETURN NEW;
END $$;

CREATE TRIGGER ledger_apply
    BEFORE INSERT ON ledger_entries
    FOR EACH ROW EXECUTE FUNCTION trg_ledger_apply();

-- An accounting ledger is append-only: corrections are new entries, never edits.
CREATE OR REPLACE FUNCTION trg_ledger_immutable() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'LEDGER_IMMUTABLE: ledger entries cannot be % (post a reversing entry instead)', lower(TG_OP)
        USING ERRCODE = 'P0001';
END $$;

CREATE TRIGGER ledger_immutable
    BEFORE UPDATE OR DELETE ON ledger_entries
    FOR EACH ROW EXECUTE FUNCTION trg_ledger_immutable();

-- ---------------------------------------------------------------------
-- 3. LOW-STOCK ALERTS: raised / auto-resolved whenever batch stock changes
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trg_batches_stock_alert() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
    v_stock   INT;
    v_reorder INT;
    v_shop    INT;
    v_name    TEXT;
BEGIN
    SELECT p.reorder_level, p.shop_id, p.name INTO v_reorder, v_shop, v_name
      FROM products p WHERE p.product_id = NEW.product_id;

    SELECT COALESCE(SUM(qty_remaining), 0) INTO v_stock
      FROM batches
     WHERE product_id = NEW.product_id
       AND (expiry_date IS NULL OR expiry_date >= current_date);

    IF v_stock <= v_reorder THEN
        INSERT INTO alerts (shop_id, product_id, kind, message)
        VALUES (v_shop, NEW.product_id, 'low_stock',
                format('%s is low: %s left (reorder level %s)', v_name, v_stock, v_reorder))
        ON CONFLICT (product_id, kind) WHERE NOT is_resolved
        DO UPDATE SET message = EXCLUDED.message;
    ELSE
        UPDATE alerts SET is_resolved = TRUE
         WHERE product_id = NEW.product_id AND kind = 'low_stock' AND NOT is_resolved;
    END IF;
    RETURN NULL;
END $$;

CREATE TRIGGER batches_stock_alert
    AFTER INSERT OR UPDATE OF qty_remaining ON batches
    FOR EACH ROW EXECUTE FUNCTION trg_batches_stock_alert();

-- keep purchases.total_amount equal to the sum of its batches (derived data)
CREATE OR REPLACE FUNCTION trg_batches_purchase_total() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.purchase_id IS NOT NULL THEN
        UPDATE purchases
           SET total_amount = total_amount + NEW.cost_price * NEW.qty_received
         WHERE purchase_id = NEW.purchase_id;
        INSERT INTO stock_movements (batch_id, change_qty, reason, ref_id, created_at)
        VALUES (NEW.batch_id, NEW.qty_received, 'purchase', NEW.purchase_id, NEW.received_at);
    END IF;
    RETURN NULL;
END $$;

CREATE TRIGGER batches_purchase_total
    AFTER INSERT ON batches
    FOR EACH ROW EXECUTE FUNCTION trg_batches_purchase_total();

-- ---------------------------------------------------------------------
-- 4. fn_process_sale : the whole billing operation as ONE atomic unit
--    * validates staff / customer / products belong to the shop
--    * locks the product's batches (SELECT ... FOR UPDATE) -> no overselling
--    * picks stock First-Expiry-First-Out, skipping expired batches
--    * prices come from the DB, never from the client
--    * credit sales write a ledger debit (trigger enforces credit limit)
--    Any RAISE rolls back everything, including the invoice row.
--    Items are processed in product_id order -> consistent lock order -> no deadlocks.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_process_sale(
    p_shop_id     INT,
    p_staff_id    INT,
    p_customer_id INT,
    p_mode        pay_mode,
    p_items       JSONB,                       -- [{"product_id": 1, "qty": 2}, ...]
    p_discount    NUMERIC DEFAULT 0,
    p_at          TIMESTAMPTZ DEFAULT now()
) RETURNS INT LANGUAGE plpgsql AS $$
DECLARE
    v_invoice  INT;
    v_item     JSONB;
    v_pid      INT;
    v_qty      INT;
    v_need     INT;
    v_price    NUMERIC(10,2);
    v_name     TEXT;
    v_avail    INT;
    v_take     INT;
    v_subtotal NUMERIC(12,2) := 0;
    v_total    NUMERIC(12,2);
    b          RECORD;
BEGIN
    IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
        RAISE EXCEPTION 'EMPTY_CART: add at least one item' USING ERRCODE = 'P0001';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM users WHERE user_id = p_staff_id AND shop_id = p_shop_id
                      AND role IN ('owner', 'staff') AND is_active) THEN
        RAISE EXCEPTION 'INVALID_STAFF: user % cannot bill for shop %', p_staff_id, p_shop_id USING ERRCODE = 'P0001';
    END IF;

    IF p_customer_id IS NOT NULL AND NOT EXISTS
       (SELECT 1 FROM customers WHERE customer_id = p_customer_id AND shop_id = p_shop_id) THEN
        RAISE EXCEPTION 'INVALID_CUSTOMER: customer % is not in this shop', p_customer_id USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO invoices (shop_id, customer_id, staff_id, payment_mode, created_at)
    VALUES (p_shop_id, p_customer_id, p_staff_id, p_mode, p_at)
    RETURNING invoice_id INTO v_invoice;

    FOR v_item IN
        SELECT value FROM jsonb_array_elements(p_items) ORDER BY (value->>'product_id')::INT
    LOOP
        v_pid := (v_item->>'product_id')::INT;
        v_qty := (v_item->>'qty')::INT;
        IF v_qty IS NULL OR v_qty <= 0 OR v_qty > 1000 THEN
            RAISE EXCEPTION 'INVALID_QTY: quantity must be between 1 and 1000' USING ERRCODE = 'P0001';
        END IF;

        SELECT selling_price, name INTO v_price, v_name
          FROM products WHERE product_id = v_pid AND shop_id = p_shop_id AND is_active;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'PRODUCT_NOT_FOUND: product % is not sold here', v_pid USING ERRCODE = 'P0001';
        END IF;

        -- lock every usable batch of this product before reading stock
        SELECT COALESCE(SUM(s.qty_remaining), 0) INTO v_avail FROM (
            SELECT qty_remaining FROM batches
             WHERE product_id = v_pid AND qty_remaining > 0
               AND (expiry_date IS NULL OR expiry_date >= p_at::DATE)
               FOR UPDATE
        ) s;

        IF v_avail < v_qty THEN
            RAISE EXCEPTION 'INSUFFICIENT_STOCK: % (available %, requested %)', v_name, v_avail, v_qty
                USING ERRCODE = 'P0001';
        END IF;

        v_need := v_qty;
        FOR b IN
            SELECT batch_id, qty_remaining, cost_price FROM batches
             WHERE product_id = v_pid AND qty_remaining > 0
               AND (expiry_date IS NULL OR expiry_date >= p_at::DATE)
             ORDER BY expiry_date NULLS LAST, batch_id          -- FEFO
        LOOP
            EXIT WHEN v_need = 0;
            v_take := LEAST(v_need, b.qty_remaining);

            UPDATE batches SET qty_remaining = qty_remaining - v_take WHERE batch_id = b.batch_id;

            INSERT INTO invoice_items (invoice_id, product_id, batch_id, qty, unit_price, unit_cost)
            VALUES (v_invoice, v_pid, b.batch_id, v_take, v_price, b.cost_price);

            INSERT INTO stock_movements (batch_id, change_qty, reason, ref_id, created_by, created_at)
            VALUES (b.batch_id, -v_take, 'sale', v_invoice, p_staff_id, p_at);

            v_need     := v_need - v_take;
            v_subtotal := v_subtotal + v_take * v_price;
        END LOOP;
    END LOOP;

    p_discount := COALESCE(p_discount, 0);
    IF p_discount < 0 OR p_discount > v_subtotal THEN
        RAISE EXCEPTION 'INVALID_DISCOUNT: discount must be between 0 and %', v_subtotal USING ERRCODE = 'P0001';
    END IF;
    v_total := v_subtotal - p_discount;

    UPDATE invoices SET subtotal = v_subtotal, discount = p_discount, total = v_total
     WHERE invoice_id = v_invoice;

    IF p_mode = 'credit' AND v_total > 0 THEN
        INSERT INTO ledger_entries (customer_id, kind, amount, invoice_id, note, created_at)
        VALUES (p_customer_id, 'debit', v_total, v_invoice, 'Credit sale, bill #' || v_invoice, p_at);
    END IF;

    RETURN v_invoice;
END $$;

-- ---------------------------------------------------------------------
-- 5. sp_record_payment (PROCEDURE) : customer pays back udhaar
-- ---------------------------------------------------------------------
CREATE OR REPLACE PROCEDURE sp_record_payment(
    p_shop_id     INT,
    p_customer_id INT,
    p_amount      NUMERIC,
    p_mode        pay_mode,
    p_user_id     INT,
    p_note        TEXT DEFAULT NULL,
    p_at          TIMESTAMPTZ DEFAULT now(),
    INOUT p_payment_id INT DEFAULT NULL
) LANGUAGE plpgsql AS $$
BEGIN
    IF p_mode = 'credit' THEN
        RAISE EXCEPTION 'INVALID_MODE: a repayment must be cash or upi' USING ERRCODE = 'P0001';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM customers WHERE customer_id = p_customer_id AND shop_id = p_shop_id) THEN
        RAISE EXCEPTION 'INVALID_CUSTOMER: customer % is not in this shop', p_customer_id USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO payments (shop_id, customer_id, amount, mode, received_by, note, created_at)
    VALUES (p_shop_id, p_customer_id, p_amount, p_mode, p_user_id, p_note, p_at)
    RETURNING payment_id INTO p_payment_id;

    -- trigger trg_ledger_apply rejects over-payment and updates the balance
    INSERT INTO ledger_entries (customer_id, kind, amount, payment_id, note, created_at)
    VALUES (p_customer_id, 'credit', p_amount, p_payment_id,
            COALESCE(p_note, 'Payment received (' || p_mode || ')'), p_at);
END $$;

-- ---------------------------------------------------------------------
-- 6. sp_write_off_expired (PROCEDURE) : remove expired stock, keep an audit trail
-- ---------------------------------------------------------------------
CREATE OR REPLACE PROCEDURE sp_write_off_expired(
    p_shop_id INT,
    p_user_id INT,
    INOUT p_batches INT DEFAULT 0,
    INOUT p_units   INT DEFAULT 0
) LANGUAGE plpgsql AS $$
DECLARE b RECORD;
BEGIN
    p_batches := 0; p_units := 0;
    FOR b IN
        SELECT bt.batch_id, bt.qty_remaining
          FROM batches bt JOIN products p ON p.product_id = bt.product_id
         WHERE p.shop_id = p_shop_id AND bt.qty_remaining > 0 AND bt.expiry_date < current_date
           FOR UPDATE OF bt
    LOOP
        INSERT INTO stock_movements (batch_id, change_qty, reason, created_by)
        VALUES (b.batch_id, -b.qty_remaining, 'expired', p_user_id);
        UPDATE batches SET qty_remaining = 0 WHERE batch_id = b.batch_id;
        p_batches := p_batches + 1;
        p_units   := p_units + b.qty_remaining;
    END LOOP;
END $$;

-- ---------------------------------------------------------------------
-- 7. SEARCH HELPERS
-- ---------------------------------------------------------------------
-- "parle g chh" -> 'parle:* | g:* | chh:*'  (prefix match while the user is typing)
CREATE OR REPLACE FUNCTION fn_prefix_tsquery(p_text TEXT)
RETURNS TSQUERY LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE WHEN s = '' THEN NULL ELSE to_tsquery('simple', s) END
      FROM (
        SELECT COALESCE(string_agg(w || ':*', ' | '), '') AS s
          FROM (SELECT regexp_replace(t, '[^[:alnum:]]', '', 'g') AS w
                  FROM regexp_split_to_table(lower(coalesce(p_text, '')), '\s+') AS t) x
         WHERE length(w) >= 2          -- single letters match almost everything
      ) y;
$$;

-- HYBRID SEARCH = full-text  +  trigram (typos)  +  vector (meaning)
-- Each method produces its own ranking; Reciprocal Rank Fusion merges them:
--     score(product) = SUM over methods of 1 / (60 + rank_in_that_method)
CREATE OR REPLACE FUNCTION fn_hybrid_search(
    p_shop_id   INT,
    p_query     TEXT,
    p_query_vec VECTOR(384) DEFAULT NULL,
    p_limit     INT DEFAULT 10
) RETURNS TABLE (
    product_id    INT,
    name          TEXT,
    brand         TEXT,
    size_label    TEXT,
    selling_price NUMERIC,
    mrp           NUMERIC,
    stock         BIGINT,
    score         NUMERIC,
    matched_by    TEXT
) LANGUAGE sql STABLE AS $$
WITH q AS (
    SELECT fn_prefix_tsquery(p_query) AS tsq
),
fts AS (
    SELECT p.product_id,
           ROW_NUMBER() OVER (ORDER BY ts_rank(p.search_doc, q.tsq) DESC) AS rnk
      FROM products p, q
     WHERE p.shop_id = p_shop_id AND p.is_active
       AND q.tsq IS NOT NULL AND p.search_doc @@ q.tsq
     ORDER BY rnk
     LIMIT 30
),
trg AS (
    SELECT x.product_id, ROW_NUMBER() OVER (ORDER BY x.sim DESC) AS rnk
      FROM (
        -- every typed word is matched separately against name + brand + aliases,
        -- then averaged: "magi noodels" -> maggi (0.6) + noodles (0.5)
        SELECT p.product_id,
               (SELECT AVG(word_similarity(w, d.doc))
                  FROM regexp_split_to_table(lower(trim(p_query)), '\s+') AS w
                 WHERE length(w) >= 2) AS sim
          FROM products p
         CROSS JOIN LATERAL (
               SELECT lower(p.name || ' ' || COALESCE(p.brand, '') || ' ' ||
                      COALESCE((SELECT string_agg(a.alias, ' ') FROM product_aliases a
                                 WHERE a.product_id = p.product_id), '')) AS doc
         ) d
         WHERE p.shop_id = p_shop_id AND p.is_active
      ) x
     WHERE x.sim >= 0.5
     ORDER BY rnk
     LIMIT 30
),
vec AS (
    SELECT p.product_id,
           ROW_NUMBER() OVER (ORDER BY p.embedding <=> p_query_vec) AS rnk
      FROM products p
     WHERE p_query_vec IS NOT NULL
       AND p.shop_id = p_shop_id AND p.is_active AND p.embedding IS NOT NULL
       AND (p.embedding <=> p_query_vec) < 0.65          -- cosine distance cut-off
     ORDER BY p.embedding <=> p_query_vec
     LIMIT 20
),
fused AS (
    SELECT u.product_id,
           SUM(1.0 / (60 + u.rnk))                    AS score,
           string_agg(u.src, '+' ORDER BY u.src)      AS matched_by
      FROM (
            SELECT fts.product_id, fts.rnk, 'text'     AS src FROM fts
            UNION ALL
            SELECT trg.product_id, trg.rnk, 'fuzzy'    AS src FROM trg
            UNION ALL
            SELECT vec.product_id, vec.rnk, 'semantic' AS src FROM vec
           ) u
     GROUP BY u.product_id
)
SELECT p.product_id, p.name::TEXT, p.brand::TEXT, p.size_label::TEXT, p.selling_price, p.mrp,
       COALESCE(s.stock, 0) AS stock, ROUND(f.score, 5) AS score, f.matched_by
  FROM fused f
  JOIN products p ON p.product_id = f.product_id
  LEFT JOIN LATERAL (
        SELECT SUM(b.qty_remaining) AS stock FROM batches b
         WHERE b.product_id = p.product_id
           AND (b.expiry_date IS NULL OR b.expiry_date >= current_date)
  ) s ON TRUE
 ORDER BY f.score DESC, p.name
 LIMIT p_limit;
$$;

-- SUBSTITUTES: closest in-stock products by embedding (falls back to same category + similar price)
CREATE OR REPLACE FUNCTION fn_similar_products(p_product_id INT, p_limit INT DEFAULT 5)
RETURNS TABLE (product_id INT, name TEXT, size_label TEXT, selling_price NUMERIC, stock BIGINT, distance NUMERIC)
LANGUAGE sql STABLE AS $$
    SELECT p.product_id, p.name::TEXT, p.size_label::TEXT, p.selling_price, s.stock,
           ROUND((CASE
                WHEN src.embedding IS NOT NULL AND p.embedding IS NOT NULL
                    THEN (p.embedding <=> src.embedding)
                ELSE 1 + ABS(p.selling_price - src.selling_price) / src.selling_price
                       + CASE WHEN p.category_id IS NOT DISTINCT FROM src.category_id THEN 0 ELSE 1 END
           END)::NUMERIC, 4) AS distance
      FROM products src
      JOIN products p ON p.shop_id = src.shop_id AND p.product_id <> src.product_id AND p.is_active
      JOIN LATERAL (
            SELECT SUM(b.qty_remaining) AS stock FROM batches b
             WHERE b.product_id = p.product_id
               AND (b.expiry_date IS NULL OR b.expiry_date >= current_date)
      ) s ON s.stock > 0
     WHERE src.product_id = p_product_id
     ORDER BY distance
     LIMIT p_limit;
$$;
