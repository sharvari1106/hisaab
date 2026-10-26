-- =====================================================================
-- Hisaab : 05_important_queries.sql
-- The queries used by the app and the report, grouped by syllabus topic.
-- Run after seeding:   psql "$DATABASE_URL" -f sql/05_important_queries.sql
-- (shop_id = 1 is the seeded demo shop)
-- =====================================================================
\pset pager off
\echo '================ UNIT 1 : relational algebra, aggregates, grouping ================'

\echo 'Q1  selection + projection  (σ category=Dairy, π name, price)'
SELECT p.name, p.size_label, p.selling_price
  FROM products p JOIN categories c ON c.category_id = p.category_id
 WHERE c.name = 'Dairy & Eggs'
 ORDER BY p.selling_price DESC;

\echo 'Q2  aggregate + GROUP BY + HAVING : categories that sold more than Rs 5000 in 30 days'
SELECT c.name AS category,
       COUNT(DISTINCT i.invoice_id) AS bills,
       SUM(ii.qty)                  AS units,
       SUM(ii.line_total)           AS revenue
  FROM invoice_items ii
  JOIN invoices i   ON i.invoice_id = ii.invoice_id
  JOIN products p   ON p.product_id = ii.product_id
  JOIN categories c ON c.category_id = p.category_id
 WHERE i.shop_id = 1 AND i.created_at >= now() - INTERVAL '30 days'
 GROUP BY c.name
HAVING SUM(ii.line_total) > 5000
 ORDER BY revenue DESC;

\echo '================ UNIT 2 : joins, subqueries, set operations, NULLs, CTEs, windows, FTS ================'

\echo 'Q3  LEFT JOIN + IS NULL : products that never sold in the last 14 days (dead stock)'
SELECT p.name, ps.stock, ps.stock_value
  FROM products p
  JOIN v_product_stock ps ON ps.product_id = p.product_id
  LEFT JOIN (SELECT DISTINCT ii.product_id
               FROM invoice_items ii JOIN invoices i ON i.invoice_id = ii.invoice_id
              WHERE i.created_at >= now() - INTERVAL '14 days') recent ON recent.product_id = p.product_id
 WHERE p.shop_id = 1 AND recent.product_id IS NULL
 ORDER BY ps.stock_value DESC;

\echo 'Q4  nested subquery (IN) : customers who bought on credit this week'
SELECT name, phone, current_balance
  FROM customers
 WHERE customer_id IN (SELECT customer_id FROM invoices
                        WHERE payment_mode = 'credit' AND created_at >= date_trunc('week', now()));

\echo 'Q5  correlated subquery : each customer''s biggest single bill vs their average bill'
SELECT c.name,
       (SELECT MAX(i.total) FROM invoices i WHERE i.customer_id = c.customer_id)            AS biggest_bill,
       (SELECT ROUND(AVG(i.total), 2) FROM invoices i WHERE i.customer_id = c.customer_id)  AS avg_bill
  FROM customers c
 WHERE c.shop_id = 1
   AND EXISTS (SELECT 1 FROM invoices i WHERE i.customer_id = c.customer_id)
 ORDER BY biggest_bill DESC;

\echo 'Q6  correlated subquery : products priced above their category average'
SELECT p.name, p.selling_price
  FROM products p
 WHERE p.selling_price > (SELECT AVG(p2.selling_price) FROM products p2 WHERE p2.category_id = p.category_id)
 ORDER BY p.selling_price DESC
 LIMIT 10;

\echo 'Q7  set operations : customers who pay digitally AND buy on credit (INTERSECT), credit-only (EXCEPT)'
SELECT c.name, 'UPI + credit' AS behaviour FROM customers c WHERE c.customer_id IN (
    SELECT customer_id FROM invoices WHERE payment_mode = 'upi'
    INTERSECT
    SELECT customer_id FROM invoices WHERE payment_mode = 'credit')
UNION ALL
SELECT c.name, 'credit only' FROM customers c WHERE c.customer_id IN (
    SELECT customer_id FROM invoices WHERE payment_mode = 'credit'
    EXCEPT
    SELECT customer_id FROM invoices WHERE payment_mode IN ('cash', 'upi'));

\echo 'Q8  NULL handling : walk-in vs named customers, products without a brand'
SELECT COALESCE(c.name, 'Walk-in customer') AS buyer, COUNT(*) AS bills, SUM(i.total) AS spent
  FROM invoices i LEFT JOIN customers c ON c.customer_id = i.customer_id
 GROUP BY COALESCE(c.name, 'Walk-in customer')
 ORDER BY spent DESC LIMIT 5;
SELECT name, COALESCE(brand, '(loose / unbranded)') AS brand FROM products WHERE brand IS NULL;

\echo 'Q9  CTE + window functions : top 3 products in every category (RANK OVER PARTITION)'
WITH product_sales AS (
    SELECT c.name AS category, p.name AS product, SUM(ii.qty) AS units
      FROM invoice_items ii
      JOIN products p   ON p.product_id = ii.product_id
      JOIN categories c ON c.category_id = p.category_id
     GROUP BY c.name, p.name
), ranked AS (
    SELECT *, RANK() OVER (PARTITION BY category ORDER BY units DESC) AS rnk FROM product_sales
)
SELECT category, product, units, rnk FROM ranked WHERE rnk <= 3 ORDER BY category, rnk;

\echo 'Q10 window : daily revenue with running total and day-over-day change (SUM OVER, LAG)'
SELECT sale_date, revenue,
       SUM(revenue) OVER (ORDER BY sale_date)                      AS running_total,
       revenue - LAG(revenue) OVER (ORDER BY sale_date)            AS change_vs_yesterday,
       ROUND(AVG(revenue) OVER (ORDER BY sale_date ROWS 6 PRECEDING), 2) AS moving_avg_7d
  FROM v_daily_sales WHERE shop_id = 1
 ORDER BY sale_date DESC LIMIT 10;

\echo 'Q11 window : customer spending quartiles (NTILE) and share of total (ratio)'
SELECT c.name, SUM(i.total) AS spent,
       NTILE(4) OVER (ORDER BY SUM(i.total) DESC)                         AS quartile,
       ROUND(100 * SUM(i.total) / SUM(SUM(i.total)) OVER (), 1)           AS pct_of_named_sales
  FROM invoices i JOIN customers c ON c.customer_id = i.customer_id
 GROUP BY c.name ORDER BY spent DESC;

\echo 'Q12 recursive CTE : how many days until stock runs out at the current sales rate'
WITH RECURSIVE rate AS (
    SELECT GREATEST(COALESCE(SUM(ii.qty), 0) / 14.0, 0.1) AS per_day
      FROM invoice_items ii
      JOIN invoices i ON i.invoice_id = ii.invoice_id
      JOIN products p ON p.product_id = ii.product_id
     WHERE p.name = '2-Minute Masala Noodles' AND i.created_at >= now() - INTERVAL '14 days'
),
burn(day, stock) AS (
    SELECT 0, (SELECT stock FROM v_product_stock WHERE name = '2-Minute Masala Noodles')::NUMERIC
    UNION ALL
    SELECT day + 1, stock - (SELECT per_day FROM rate)
      FROM burn WHERE stock > 0 AND day < 90
)
SELECT (SELECT ROUND(per_day, 2) FROM rate) AS units_per_day, MAX(day) AS days_until_stockout FROM burn;

\echo 'Q13 full-text search with ranking and highlighted match'
SELECT p.name, ts_rank(p.search_doc, q) AS rank,
       ts_headline('simple', p.name || ' ' || COALESCE(p.brand, ''), q) AS highlighted
  FROM products p, to_tsquery('simple', 'chawal | akki') q
 WHERE p.search_doc @@ q
 ORDER BY rank DESC;

\echo 'Q14 hybrid search (full-text + trigram + vector, fused with RRF)'
SELECT * FROM fn_hybrid_search(1, 'surf');
SELECT * FROM fn_hybrid_search(1, 'thengai ennai');
SELECT * FROM fn_hybrid_search(1, 'magi noodels');      -- typos

\echo 'Q15 vector similarity: nearest neighbours of Maggi by cosine distance (needs npm run embed)'
SELECT p2.name, ROUND((p2.embedding <=> p1.embedding)::NUMERIC, 4) AS cosine_distance
  FROM products p1 JOIN products p2 ON p2.product_id <> p1.product_id AND p2.embedding IS NOT NULL
 WHERE p1.name = '2-Minute Masala Noodles' AND p1.embedding IS NOT NULL
 ORDER BY p2.embedding <=> p1.embedding
 LIMIT 5;

\echo 'Q16 views : risk ranking, reorder list, expiring stock, monthly P&L'
SELECT risk_rank, name, current_balance, credit_limit, risk_score, risk_band, days_since_payment FROM v_customer_risk ORDER BY risk_rank LIMIT 5;
SELECT name, stock, avg_daily_14d, days_of_stock_left, suggested_order_qty FROM v_reorder_suggestions ORDER BY days_of_stock_left NULLS FIRST;
SELECT name, batch_no, expiry_date, days_left, qty_remaining, suggested_discount_pct FROM v_expiring_soon ORDER BY days_left;
SELECT * FROM mv_monthly_sales ORDER BY month;

\echo '================ DML : INSERT / UPDATE / DELETE (inside a transaction, rolled back) ================'
BEGIN;
INSERT INTO suppliers (shop_id, name, phone) VALUES (1, 'Demo Supplier', '9123456780') RETURNING supplier_id, name;
UPDATE products SET selling_price = selling_price - 1
 WHERE shop_id = 1 AND product_id IN (SELECT product_id FROM v_expiring_soon WHERE days_left <= 3)
   AND selling_price > 1
RETURNING name, selling_price AS new_price;
DELETE FROM alerts WHERE is_resolved RETURNING alert_id, message;
ROLLBACK;

\echo '================ UNIT 3 : query processing / optimisation ================'
\echo 'Q17 EXPLAIN ANALYZE with and without the partial FEFO index'
EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF, SUMMARY OFF)
SELECT batch_id, qty_remaining FROM batches
 WHERE product_id = 5 AND qty_remaining > 0 ORDER BY expiry_date NULLS LAST, batch_id;
BEGIN;
DROP INDEX idx_batches_fefo;
SET LOCAL enable_seqscan = on;
EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF, SUMMARY OFF)
SELECT batch_id, qty_remaining FROM batches
 WHERE product_id = 5 AND qty_remaining > 0 ORDER BY expiry_date NULLS LAST, batch_id;
ROLLBACK;  -- index comes back

\echo 'Q18 EXPLAIN: GIN index used for full-text search'
SET enable_seqscan = off;
EXPLAIN (COSTS OFF) SELECT product_id FROM products WHERE search_doc @@ to_tsquery('simple', 'doodh');
RESET enable_seqscan;

\echo '================ UNIT 4 : transactions & locking ================'
\echo 'Q19 who is holding locks right now? (run during the two-tab concurrency demo)'
SELECT l.locktype, l.relation::regclass, l.mode, l.granted, a.pid, left(a.query, 60) AS query
  FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid
 WHERE a.datname = current_database() AND a.pid <> pg_backend_pid() AND l.relation IS NOT NULL;
