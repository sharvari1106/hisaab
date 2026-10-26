-- =====================================================================
-- Hisaab : 03_views.sql
-- Views, CTEs, window functions and a materialized view for reporting
-- =====================================================================

-- Current stock per product (expired batches excluded from sellable stock)
CREATE OR REPLACE VIEW v_product_stock AS
SELECT p.product_id,
       p.shop_id,
       p.name,
       p.brand,
       p.size_label,
       c.name                                            AS category,
       p.mrp,
       p.selling_price,
       p.reorder_level,
       p.is_active,
       COALESCE(SUM(b.qty_remaining) FILTER (WHERE b.expiry_date IS NULL OR b.expiry_date >= current_date), 0)::INT AS stock,
       COALESCE(SUM(b.qty_remaining) FILTER (WHERE b.expiry_date < current_date), 0)::INT                         AS expired_qty,
       MIN(b.expiry_date) FILTER (WHERE b.qty_remaining > 0 AND b.expiry_date >= current_date)                     AS nearest_expiry,
       COALESCE(SUM(b.qty_remaining * b.cost_price), 0)::NUMERIC(12,2)                                              AS stock_value,
       CASE
         WHEN COALESCE(SUM(b.qty_remaining) FILTER (WHERE b.expiry_date IS NULL OR b.expiry_date >= current_date), 0) = 0 THEN 'OUT'
         WHEN COALESCE(SUM(b.qty_remaining) FILTER (WHERE b.expiry_date IS NULL OR b.expiry_date >= current_date), 0) <= p.reorder_level THEN 'LOW'
         ELSE 'OK'
       END                                               AS status
  FROM products p
  LEFT JOIN categories c ON c.category_id = p.category_id
  LEFT JOIN batches b    ON b.product_id = p.product_id AND b.qty_remaining > 0
 GROUP BY p.product_id, c.name;

-- Batches expiring in the next 7 days with a suggested clearance discount
CREATE OR REPLACE VIEW v_expiring_soon AS
SELECT b.batch_id,
       p.shop_id,
       p.product_id,
       p.name,
       p.size_label,
       b.batch_no,
       b.expiry_date,
       (b.expiry_date - current_date)          AS days_left,
       b.qty_remaining,
       (b.qty_remaining * b.cost_price)::NUMERIC(12,2) AS value_at_risk,
       CASE WHEN b.expiry_date - current_date <= 2 THEN 30
            WHEN b.expiry_date - current_date <= 4 THEN 20
            ELSE 10 END                         AS suggested_discount_pct
  FROM batches b
  JOIN products p ON p.product_id = b.product_id
 WHERE b.qty_remaining > 0
   AND b.expiry_date BETWEEN current_date AND current_date + 7;

-- Daily sales summary
CREATE OR REPLACE VIEW v_daily_sales AS
SELECT i.shop_id,
       i.created_at::DATE                                       AS sale_date,
       COUNT(*)                                                 AS invoices,
       SUM(i.total)                                             AS revenue,
       SUM(i.total) FILTER (WHERE i.payment_mode = 'credit')    AS credit_sales,
       SUM(i.total) FILTER (WHERE i.payment_mode <> 'credit')   AS paid_sales
  FROM invoices i
 GROUP BY i.shop_id, i.created_at::DATE;

-- ---------------------------------------------------------------------
-- CUSTOMER CREDIT RISK SCORE (0-100) built with CTEs + window functions
--   40 pts  credit utilisation   (balance / limit)
--   30 pts  days since last payment (capped at 60 days, only if they owe money)
--   30 pts  repayment ratio in the last 90 days (repaid / borrowed)
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW v_customer_risk AS
WITH flows AS (
    SELECT customer_id,
           SUM(amount) FILTER (WHERE kind = 'debit'  AND created_at >= now() - INTERVAL '90 days') AS borrowed_90d,
           SUM(amount) FILTER (WHERE kind = 'credit' AND created_at >= now() - INTERVAL '90 days') AS repaid_90d,
           MAX(created_at) FILTER (WHERE kind = 'credit')                                          AS last_payment_at
      FROM ledger_entries
     GROUP BY customer_id
),
repay_gaps AS (
    -- for every credit sale, when was the NEXT payment? (window over the ledger)
    SELECT customer_id,
           AVG(EXTRACT(EPOCH FROM (next_payment - created_at)) / 86400.0) AS avg_days_to_repay
      FROM (
            SELECT customer_id, kind, created_at,
                   MIN(created_at) FILTER (WHERE kind = 'credit')
                       OVER (PARTITION BY customer_id ORDER BY created_at
                             ROWS BETWEEN 1 FOLLOWING AND UNBOUNDED FOLLOWING) AS next_payment
              FROM ledger_entries
           ) t
     WHERE kind = 'debit' AND next_payment IS NOT NULL
     GROUP BY customer_id
),
base AS (
    SELECT c.customer_id, c.shop_id, c.name, c.phone, c.credit_limit, c.current_balance,
           COALESCE(f.borrowed_90d, 0)                              AS borrowed_90d,
           COALESCE(f.repaid_90d, 0)                                AS repaid_90d,
           f.last_payment_at,
           ROUND(g.avg_days_to_repay::NUMERIC, 1)                   AS avg_days_to_repay,
           EXTRACT(DAY FROM now() - COALESCE(f.last_payment_at, c.created_at))::INT AS days_since_payment
      FROM customers c
      LEFT JOIN flows f      ON f.customer_id = c.customer_id
      LEFT JOIN repay_gaps g ON g.customer_id = c.customer_id
),
scored AS (
    SELECT b.*,
           ROUND((
               40 * LEAST(COALESCE(b.current_balance / NULLIF(b.credit_limit, 0), 0), 1)
             + 30 * LEAST(b.days_since_payment / 60.0, 1) * (b.current_balance > 0)::INT
             + 30 * CASE WHEN b.borrowed_90d = 0 THEN 0
                         ELSE 1 - LEAST(b.repaid_90d / b.borrowed_90d, 1) END
           )::NUMERIC, 1) AS risk_score
      FROM base b
)
SELECT s.*,
       CASE WHEN s.risk_score >= 60 THEN 'HIGH'
            WHEN s.risk_score >= 30 THEN 'MEDIUM'
            ELSE 'LOW' END                                                  AS risk_band,
       RANK() OVER (PARTITION BY s.shop_id ORDER BY s.risk_score DESC)      AS risk_rank
  FROM scored s;

-- Month-by-month credit trend per customer (running balance + LAG)
CREATE OR REPLACE VIEW v_customer_monthly_trend AS
SELECT m.customer_id,
       m.month,
       m.borrowed,
       m.repaid,
       SUM(m.borrowed - m.repaid) OVER (PARTITION BY m.customer_id ORDER BY m.month)  AS closing_balance,
       m.borrowed - LAG(m.borrowed) OVER (PARTITION BY m.customer_id ORDER BY m.month) AS borrowed_change
  FROM (
        SELECT customer_id,
               date_trunc('month', created_at)::DATE                          AS month,
               COALESCE(SUM(amount) FILTER (WHERE kind = 'debit'), 0)         AS borrowed,
               COALESCE(SUM(amount) FILTER (WHERE kind = 'credit'), 0)        AS repaid
          FROM ledger_entries
         GROUP BY customer_id, date_trunc('month', created_at)
       ) m;

-- ---------------------------------------------------------------------
-- REORDER SUGGESTIONS: moving averages of daily sales (window frames)
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW v_reorder_suggestions AS
WITH days AS (
    SELECT generate_series(current_date - 27, current_date, INTERVAL '1 day')::DATE AS d
),
sales AS (
    SELECT ii.product_id, i.created_at::DATE AS d, SUM(ii.qty) AS qty
      FROM invoice_items ii
      JOIN invoices i ON i.invoice_id = ii.invoice_id
     WHERE i.created_at >= current_date - 27
     GROUP BY ii.product_id, i.created_at::DATE
),
daily AS (
    SELECT p.product_id, days.d, COALESCE(s.qty, 0) AS qty
      FROM products p
     CROSS JOIN days
      LEFT JOIN sales s ON s.product_id = p.product_id AND s.d = days.d
     WHERE p.is_active
),
moving AS (
    SELECT product_id, d,
           AVG(qty) OVER (PARTITION BY product_id ORDER BY d ROWS BETWEEN 6  PRECEDING AND CURRENT ROW) AS avg7,
           AVG(qty) OVER (PARTITION BY product_id ORDER BY d ROWS BETWEEN 13 PRECEDING AND CURRENT ROW) AS avg14
      FROM daily
),
latest AS (
    SELECT DISTINCT ON (product_id) product_id, avg7, avg14
      FROM moving
     ORDER BY product_id, d DESC
)
SELECT ps.product_id,
       ps.shop_id,
       ps.name,
       ps.size_label,
       ps.stock,
       ps.reorder_level,
       ROUND(l.avg7, 2)                                                   AS avg_daily_7d,
       ROUND(l.avg14, 2)                                                  AS avg_daily_14d,
       CASE WHEN l.avg14 > 0 THEN ROUND(ps.stock / l.avg14, 1) END        AS days_of_stock_left,
       GREATEST(CEIL(l.avg14 * 14) - ps.stock, ps.reorder_level * 2 - ps.stock, 0)::INT AS suggested_order_qty
  FROM latest l
  JOIN v_product_stock ps ON ps.product_id = l.product_id
 WHERE ps.stock <= ps.reorder_level
    OR (l.avg14 > 0 AND ps.stock / l.avg14 < 7);

-- ---------------------------------------------------------------------
-- MATERIALIZED VIEW: monthly P&L (expensive to compute, refreshed on demand)
-- ---------------------------------------------------------------------
CREATE MATERIALIZED VIEW mv_monthly_sales AS
SELECT i.shop_id,
       date_trunc('month', i.created_at)::DATE                               AS month,
       COUNT(DISTINCT i.invoice_id)                                          AS invoices,
       SUM(ii.line_total)                                                    AS gross_sales,
       SUM(ii.qty * ii.unit_cost)                                            AS cost_of_goods,
       SUM(ii.line_total) - SUM(ii.qty * ii.unit_cost)                       AS gross_profit,
       ROUND(100.0 * SUM(ii.line_total) FILTER (WHERE i.payment_mode = 'credit')
             / NULLIF(SUM(ii.line_total), 0), 1)                             AS credit_share_pct
  FROM invoices i
  JOIN invoice_items ii ON ii.invoice_id = i.invoice_id
 GROUP BY i.shop_id, date_trunc('month', i.created_at)
WITH DATA;

CREATE UNIQUE INDEX uq_mv_monthly_sales ON mv_monthly_sales (shop_id, month);  -- allows REFRESH ... CONCURRENTLY

CREATE OR REPLACE PROCEDURE sp_refresh_reports() LANGUAGE plpgsql AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_monthly_sales;
END $$;
