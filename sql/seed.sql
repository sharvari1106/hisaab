-- =====================================================================
-- Hisaab : seed.sql  -  realistic demo data for one kirana store
-- Every login uses the password:  password123
-- 30 days of sales are SIMULATED by calling fn_process_sale / sp_record_payment
-- with back-dated timestamps, so all triggers, ledgers and stock movements
-- are produced by the real business logic (not inserted by hand).
-- =====================================================================

SELECT setseed(0.42);   -- deterministic "random" data

INSERT INTO categories (name) VALUES
  ('Dairy & Eggs'), ('Bakery'), ('Staples'), ('Spices'), ('Snacks'),
  ('Beverages'), ('Instant Food'), ('Personal Care'), ('Household')
ON CONFLICT (name) DO NOTHING;

DO $$
DECLARE
    pwd    CONSTANT TEXT := '$2a$10$DAQ98M9bk..Y9Cv9KogXN.HpN8hfAUJJn1JgOuD0gZOZNrUdKVJLS';  -- bcrypt("password123")
    v_shop INT; v_owner INT; v_staff1 INT; v_staff2 INT;
    v_sup  INT[];
    r      RECORD;
    v_pid  INT;
    v_pur1 INT; v_pur2 INT; v_pur3 INT;
    v_day  DATE;
    v_n    INT;
    v_items JSONB;
    v_mode pay_mode;
    v_cust INT;
    v_at   TIMESTAMPTZ;
    v_products INT[];
    v_customers INT[];
    v_staff INT[];
    v_amt  NUMERIC;
    v_pay  INT;
    v_perishable BOOLEAN;
    i INT; k INT;
BEGIN
    -- ---------- platform admin ----------
    INSERT INTO users (name, phone, password_hash, role) VALUES ('Platform Admin', '9999900000', pwd, 'admin');

    -- ---------- shop + owner + staff ----------
    INSERT INTO shops (name, address, phone, gstin)
    VALUES ('Sri Lakshmi Provision Stores', '14, 3rd Cross, Hosakerehalli, Bengaluru 560085', '9876543210', '29ABCDE1234F1Z5')
    RETURNING shop_id INTO v_shop;

    INSERT INTO users (name, phone, password_hash, role, shop_id) VALUES ('Nagaraj (Owner)', '9876543210', pwd, 'owner', v_shop) RETURNING user_id INTO v_owner;
    INSERT INTO users (name, phone, password_hash, role, shop_id) VALUES ('Manju (Counter)', '9876543211', pwd, 'staff', v_shop) RETURNING user_id INTO v_staff1;
    INSERT INTO users (name, phone, password_hash, role, shop_id) VALUES ('Shivu (Counter)', '9876543212', pwd, 'staff', v_shop) RETURNING user_id INTO v_staff2;
    UPDATE shops SET owner_id = v_owner WHERE shop_id = v_shop;
    v_staff := ARRAY[v_owner, v_staff1, v_staff1, v_staff2];

    -- ---------- suppliers ----------
    INSERT INTO suppliers (shop_id, name, phone) VALUES
        (v_shop, 'Metro Wholesale Distributors', '9880011001'),
        (v_shop, 'Nandini Milk Agency',          '9880011002'),
        (v_shop, 'Sri Ganesh FMCG Traders',      '9880011003');
    SELECT array_agg(supplier_id ORDER BY supplier_id) INTO v_sup FROM suppliers WHERE shop_id = v_shop;

    -- ---------- customers (udhaar accounts) ----------
    INSERT INTO customers (shop_id, name, phone, address, credit_limit, created_at) VALUES
        (v_shop, 'Ramesh Kumar',   '9845012345', 'Flat 2B, Lakshmi Residency', 3000, now() - INTERVAL '60 days'),
        (v_shop, 'Lakshmi Devi',   '9845012346', '#22, 4th Main',              5000, now() - INTERVAL '60 days'),
        (v_shop, 'Suresh Gowda',   '9845012347', 'Near Ganesha Temple',        2000, now() - INTERVAL '60 days'),
        (v_shop, 'Anitha Rao',     '9845012348', '#7, 2nd Cross',              4000, now() - INTERVAL '60 days'),
        (v_shop, 'Mohammed Irfan', '9845012349', 'Opp. Bus Stop',              2500, now() - INTERVAL '60 days'),
        (v_shop, 'Priya Sharma',   '9845012350', 'PG, 5th Cross',              1500, now() - INTERVAL '60 days'),
        (v_shop, 'Venkatesh',      '9845012351', 'Auto stand',                 3000, now() - INTERVAL '60 days'),
        (v_shop, 'Kavya N',        '9845012352', '#90, Main Road',             2000, now() - INTERVAL '60 days'),
        (v_shop, 'Harish (Hostel)','9845012353', 'Boys Hostel Block C',        1000, now() - INTERVAL '60 days'),
        (v_shop, 'Deepa Hegde',    '9845012354', '#3, Temple Street',          2500, now() - INTERVAL '60 days');
    SELECT array_agg(customer_id ORDER BY customer_id) INTO v_customers FROM customers WHERE shop_id = v_shop;

    -- customer portal logins
    INSERT INTO users (name, phone, password_hash, role, shop_id, customer_id)
    SELECT name, phone, pwd, 'customer', v_shop, customer_id FROM customers
     WHERE shop_id = v_shop AND phone IN ('9845012345', '9845012346');

    -- ---------- products + local-language aliases ----------
    CREATE TEMP TABLE seed_products (name TEXT, brand TEXT, size TEXT, unit TEXT, cat TEXT,
                                     mrp NUMERIC, price NUMERIC, reorder INT, aliases TEXT[]) ON COMMIT DROP;
    INSERT INTO seed_products VALUES
    ('Taaza Toned Milk',            'Amul',      '500 ml', 'pack', 'Dairy & Eggs',  28,  27, 10, ARRAY['doodh:hi','haalu:kn','paal:ta','milk packet:en']),
    ('Nandini Curd',                'Nandini',   '500 g',  'pack', 'Dairy & Eggs',  30,  30,  6, ARRAY['dahi:hi','mosaru:kn','thayir:ta']),
    ('Amul Butter',                 'Amul',      '100 g',  'pcs',  'Dairy & Eggs',  58,  58,  4, ARRAY['makhan:hi','benne:kn','vennai:ta']),
    ('Fresh Paneer',                'Nandini',   '200 g',  'pack', 'Dairy & Eggs',  90,  88,  3, ARRAY['paneer:hi','cottage cheese:en']),
    ('Farm Eggs',                   NULL,        '6 pcs',  'pack', 'Dairy & Eggs',  48,  45,  5, ARRAY['anda:hi','motte:kn','muttai:ta']),
    ('Sandwich Bread',              'Modern',    '400 g',  'pcs',  'Bakery',        45,  45,  5, ARRAY['double roti:hi','pav:hi']),
    ('Milk Rusk',                   'Britannia', '200 g',  'pack', 'Bakery',        40,  38,  4, ARRAY['toast:hi','rusk:en']),
    ('Basmati Rice',                'India Gate','1 kg',   'pack', 'Staples',      145, 135,  5, ARRAY['chawal:hi','akki:kn','arisi:ta']),
    ('Sona Masoori Rice',           'Udaan',     '5 kg',   'pack', 'Staples',      360, 340,  4, ARRAY['chawal:hi','akki:kn','arisi:ta','ration rice:en']),
    ('Whole Wheat Atta',            'Aashirvaad','5 kg',   'pack', 'Staples',      290, 275,  4, ARRAY['gehun ka atta:hi','godhi hittu:kn','atta:hi']),
    ('Toor Dal',                    'Tata Sampann','1 kg', 'pack', 'Staples',      170, 160,  5, ARRAY['arhar dal:hi','togari bele:kn','thuvaram paruppu:ta']),
    ('Moong Dal',                   'Tata Sampann','500 g','pack', 'Staples',       85,  80,  4, ARRAY['moong:hi','hesaru bele:kn','pasi paruppu:ta']),
    ('Iodised Salt',                'Tata',      '1 kg',   'pack', 'Staples',       28,  28,  6, ARRAY['namak:hi','uppu:kn','uppu:ta']),
    ('Refined Sugar',               'Madhur',    '1 kg',   'pack', 'Staples',       55,  52,  6, ARRAY['cheeni:hi','sakkare:kn','sakkarai:ta']),
    ('Sunflower Oil',               'Fortune',   '1 l',    'pack', 'Staples',      165, 155,  5, ARRAY['tel:hi','enne:kn','ennai:ta','cooking oil:en']),
    ('Bombay Rava',                 'MTR',       '500 g',  'pack', 'Staples',       40,  38,  4, ARRAY['suji:hi','sooji:hi','rava:kn']),
    ('Garam Masala',                'MDH',       '100 g',  'pcs',  'Spices',        82,  80,  3, ARRAY['masala:hi']),
    ('Turmeric Powder',             'Everest',   '100 g',  'pcs',  'Spices',        38,  36,  3, ARRAY['haldi:hi','arishina:kn','manjal:ta']),
    ('Red Chilli Powder',           'Everest',   '100 g',  'pcs',  'Spices',        45,  42,  3, ARRAY['lal mirch:hi','menasina pudi:kn','milagai thool:ta']),
    ('Mustard Seeds',               NULL,        '100 g',  'pack', 'Spices',        25,  24,  3, ARRAY['rai:hi','sasive:kn','kadugu:ta']),
    ('Parle-G Glucose Biscuit',     'Parle',     '250 g',  'pack', 'Snacks',        25,  25,  8, ARRAY['parle g:en','glucose biscuit:en','biscuit:hi']),
    ('Good Day Cashew Cookies',     'Britannia', '200 g',  'pack', 'Snacks',        35,  35,  5, ARRAY['good day:en','cookies:en']),
    ('Classic Salted Chips',        'Lay''s',    '52 g',   'pack', 'Snacks',        20,  20,  8, ARRAY['chips:en','wafers:hi']),
    ('Aloo Bhujia',                 'Haldiram''s','200 g', 'pack', 'Snacks',        55,  55,  4, ARRAY['namkeen:hi','mixture:kn','bhujia:hi']),
    ('Masala Munch',                'Kurkure',   '75 g',   'pack', 'Snacks',        20,  20,  6, ARRAY['kurkure:en']),
    ('Tea Gold',                    'Tata',      '250 g',  'pack', 'Beverages',    140, 135,  4, ARRAY['chai patti:hi','tea powder:en','tea pudi:kn']),
    ('Instant Coffee',              'Bru',       '100 g',  'pcs',  'Beverages',    220, 215,  3, ARRAY['coffee powder:en','kaapi pudi:kn','kaapi:ta']),
    ('Coca-Cola',                   'Coca-Cola', '750 ml', 'pcs',  'Beverages',     40,  40,  6, ARRAY['coke:en','cold drink:hi','soft drink:en']),
    ('Packaged Drinking Water',     'Bisleri',   '1 l',    'pcs',  'Beverages',     20,  20, 10, ARRAY['pani:hi','neeru:kn','thanni:ta','water bottle:en']),
    ('Mango Drink',                 'Frooti',    '200 ml', 'pcs',  'Beverages',     15,  15,  8, ARRAY['frooti:en','aam juice:hi']),
    ('2-Minute Masala Noodles',     'Maggi',     '70 g',   'pack', 'Instant Food',  14,  14, 10, ARRAY['maggi:en','noodles:en']),
    ('Magic Masala Noodles',        'Yippee',    '70 g',   'pack', 'Instant Food',  14,  14,  6, ARRAY['yippee:en','noodles:en']),
    ('Rava Idli Mix',               'MTR',       '500 g',  'pack', 'Instant Food', 110, 105,  3, ARRAY['idli mix:en']),
    ('Tomato Ketchup',              'Kissan',    '500 g',  'pcs',  'Instant Food', 130, 120,  3, ARRAY['sauce:en','tomato sauce:en']),
    ('Lifebuoy Total Soap',         'Lifebuoy',  '100 g',  'pcs',  'Personal Care', 38,  36,  6, ARRAY['sabun:hi','bathing soap:en']),
    ('Strong Teeth Toothpaste',     'Colgate',   '200 g',  'pcs',  'Personal Care',115, 110,  4, ARRAY['manjan:hi','paste:en','colgate:en']),
    ('Anti-Dandruff Shampoo',       'Clinic Plus','175 ml','pcs',  'Personal Care',120, 115,  3, ARRAY['shampoo:en']),
    ('Coconut Oil',                 'Parachute', '250 ml', 'pcs',  'Personal Care',115, 110,  4, ARRAY['nariyal tel:hi','kobbari enne:kn','thengai ennai:ta','hair oil:en']),
    ('Hand Wash Refill',            'Dettol',    '200 ml', 'pcs',  'Personal Care', 99,  95,  3, ARRAY['handwash:en']),
    ('Easy Wash Detergent Powder',  'Surf Excel','1 kg',   'pack', 'Household',    140, 135,  4, ARRAY['washing powder:en','surf:en','kapde ka sabun:hi']),
    ('Dishwash Bar',                'Vim',       '200 g',  'pcs',  'Household',     25,  24,  6, ARRAY['bartan sabun:hi','vim bar:en','paathre sopu:kn']),
    ('Toilet Cleaner',              'Harpic',    '500 ml', 'pcs',  'Household',    110, 105,  3, ARRAY['harpic:en']),
    ('Mosquito Repellent Refill',   'Good Knight','45 ml', 'pcs',  'Household',     80,  78,  3, ARRAY['machhar:hi','mosquito liquid:en','sollige:kn']),
    ('3-in-1 Agarbatti',            'Cycle',     '1 box',  'pack', 'Household',     60,  60,  3, ARRAY['agarbatti:hi','oodubatti:kn','incense sticks:en']);

    -- two stock deliveries: 35 days ago and 15 days ago (purchases + batches)
    INSERT INTO purchases (shop_id, supplier_id, supplier_invoice_no, purchase_date, created_by, created_at)
    VALUES (v_shop, v_sup[1], 'MWD/2026/0412', current_date - 35, v_owner, now() - INTERVAL '35 days') RETURNING purchase_id INTO v_pur1;
    INSERT INTO purchases (shop_id, supplier_id, supplier_invoice_no, purchase_date, created_by, created_at)
    VALUES (v_shop, v_sup[3], 'SGF-88213', current_date - 15, v_owner, now() - INTERVAL '15 days') RETURNING purchase_id INTO v_pur2;
    INSERT INTO purchases (shop_id, supplier_id, supplier_invoice_no, purchase_date, created_by, created_at)
    VALUES (v_shop, v_sup[2], 'NMA-5521', current_date - 6, v_owner, now() - INTERVAL '6 days') RETURNING purchase_id INTO v_pur3;

    FOR r IN SELECT * FROM seed_products LOOP
        INSERT INTO products (shop_id, category_id, name, brand, size_label, unit, mrp, selling_price, reorder_level, created_at)
        VALUES (v_shop, (SELECT category_id FROM categories WHERE name = r.cat), r.name, r.brand, r.size, r.unit,
                r.mrp, r.price, r.reorder, now() - INTERVAL '40 days')
        RETURNING product_id INTO v_pid;

        INSERT INTO product_aliases (product_id, alias, language)
        SELECT v_pid, split_part(a, ':', 1), split_part(a, ':', 2) FROM unnest(r.aliases) a
        ON CONFLICT DO NOTHING;

        v_perishable := r.cat IN ('Dairy & Eggs', 'Bakery');
        IF v_perishable THEN
            -- old batch partly expired (write-off demo) + fresh batch expiring soon (clearance demo)
            INSERT INTO batches (product_id, purchase_id, batch_no, mfg_date, expiry_date, cost_price, qty_received, qty_remaining, received_at)
            VALUES (v_pid, v_pur1, 'B' || v_pid || '-1', current_date - 36, current_date - 2, round(r.price * 0.85, 2), 45, 45, now() - INTERVAL '35 days'),
                   (v_pid, v_pur3, 'B' || v_pid || '-3', current_date - 7,  current_date + 3 + (v_pid % 4), round(r.price * 0.85, 2), 30, 30, now() - INTERVAL '6 days');
        ELSE
            INSERT INTO batches (product_id, purchase_id, batch_no, mfg_date, expiry_date, cost_price, qty_received, qty_remaining, received_at)
            VALUES (v_pid, v_pur1, 'B' || v_pid || '-1', current_date - 60, current_date + 120 + (v_pid % 90), round(r.price * 0.82, 2),
                    20 + (v_pid * 7) % 30, 20 + (v_pid * 7) % 30, now() - INTERVAL '35 days'),
                   (v_pid, v_pur2, 'B' || v_pid || '-2', current_date - 20, current_date + 200 + (v_pid % 60), round(r.price * 0.83, 2),
                    10 + (v_pid * 3) % 20, 10 + (v_pid * 3) % 20, now() - INTERVAL '15 days');
        END IF;
    END LOOP;

    SELECT array_agg(product_id ORDER BY product_id) INTO v_products FROM products WHERE shop_id = v_shop;

    -- ---------- simulate 30 days of trading ----------
    FOR v_day IN SELECT generate_series(current_date - 30, current_date, INTERVAL '1 day')::DATE LOOP
        v_n := 8 + floor(random() * 10)::INT
             + CASE WHEN extract(isodow FROM v_day) IN (6, 7) THEN 5 ELSE 0 END;     -- busier weekends
        FOR i IN 1..v_n LOOP
            -- 1 to 4 random items
            v_items := '[]'::JSONB;
            FOR k IN 1..(1 + floor(random() * 4)::INT) LOOP
                v_items := v_items || jsonb_build_array(jsonb_build_object(
                    'product_id', v_products[1 + floor(random() * array_length(v_products, 1))::INT],
                    'qty', 1 + floor(random() * random() * 3)::INT));
            END LOOP;

            v_cust := NULL;
            CASE
                WHEN random() < 0.55 THEN v_mode := 'cash';
                WHEN random() < 0.55 THEN v_mode := 'upi';
                ELSE v_mode := 'credit';
            END CASE;
            IF v_mode = 'credit' OR random() < 0.2 THEN
                v_cust := v_customers[1 + floor(random() * array_length(v_customers, 1))::INT];
            END IF;

            -- shop hours 7am-10pm, peaks in the morning and evening
            v_at := v_day + make_interval(hours => (ARRAY[7,7,8,8,9,10,11,12,13,16,17,18,18,19,19,20,20,21])[1 + floor(random() * 18)::INT],
                                          mins  => floor(random() * 60)::INT);
            IF v_at > now() THEN CONTINUE; END IF;

            BEGIN
                PERFORM fn_process_sale(v_shop, v_staff[1 + floor(random() * 4)::INT], v_cust, v_mode, v_items, 0, v_at);
            EXCEPTION WHEN OTHERS THEN
                NULL;   -- out of stock / over credit limit: that bill simply didn't happen
            END;
        END LOOP;

        -- evening repayments; Suresh (3rd) and Harish (9th) rarely pay -> high risk
        FOR k IN 1..array_length(v_customers, 1) LOOP
            SELECT current_balance INTO v_amt FROM customers WHERE customer_id = v_customers[k];
            IF v_amt > 0 AND random() < (CASE WHEN k IN (3, 9) THEN 0.03 ELSE 0.18 END) THEN
                v_amt := round(v_amt * (0.4 + random() * 0.6));
                v_at  := v_day + TIME '20:30';
                IF v_amt > 0 AND v_at <= now() THEN
                    CALL sp_record_payment(v_shop, v_customers[k], v_amt,
                                           (CASE WHEN random() < 0.5 THEN 'cash' ELSE 'upi' END)::pay_mode,
                                           v_owner, NULL, v_at, v_pay);
                END IF;
            END IF;
        END LOOP;
    END LOOP;

    RAISE NOTICE 'Seeded shop % with % products, % invoices, % ledger entries',
        v_shop, array_length(v_products, 1),
        (SELECT COUNT(*) FROM invoices WHERE shop_id = v_shop),
        (SELECT COUNT(*) FROM ledger_entries);
END $$;

REFRESH MATERIALIZED VIEW mv_monthly_sales;
