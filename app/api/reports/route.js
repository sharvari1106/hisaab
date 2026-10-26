import { handler, requireUser } from '@/lib/api';
import { many, one } from '@/lib/db';
import { activityAnalytics } from '@/lib/analytics';

// GET /api/reports (owner) - SQL reports + MongoDB analytics in parallel
export const GET = handler(async (request) => {
  const s = await requireUser(request, ['owner']);
  const shop = s.shopId;

  const [kpis, daily, topProducts, categories, staff, modes, reorder, risk, monthly, mongo] = await Promise.all([
    one(
      `SELECT
         (SELECT COALESCE(SUM(total), 0) FROM invoices WHERE shop_id = $1 AND created_at >= current_date)          AS today_revenue,
         (SELECT COUNT(*)                FROM invoices WHERE shop_id = $1 AND created_at >= current_date)          AS today_bills,
         (SELECT COALESCE(SUM(current_balance), 0) FROM customers WHERE shop_id = $1)                              AS outstanding_credit,
         (SELECT COUNT(*) FROM customers WHERE shop_id = $1 AND current_balance > 0)                               AS debtors,
         (SELECT COALESCE(SUM(ii.line_total - ii.qty * ii.unit_cost), 0)
            FROM invoice_items ii JOIN invoices i ON i.invoice_id = ii.invoice_id
           WHERE i.shop_id = $1 AND i.created_at >= date_trunc('month', now()))                                    AS month_profit,
         (SELECT COALESCE(SUM(stock_value), 0) FROM v_product_stock WHERE shop_id = $1)                            AS stock_value,
         (SELECT COUNT(*) FROM alerts WHERE shop_id = $1 AND NOT is_resolved)                                      AS open_alerts`,
      [shop]
    ),
    many(
      `SELECT d::DATE AS sale_date, COALESCE(v.revenue, 0) AS revenue, COALESCE(v.invoices, 0) AS invoices,
              COALESCE(v.credit_sales, 0) AS credit_sales
         FROM generate_series(current_date - 13, current_date, INTERVAL '1 day') d
         LEFT JOIN v_daily_sales v ON v.sale_date = d::DATE AND v.shop_id = $1
        ORDER BY d`,
      [shop]
    ),
    // GROUP BY + HAVING: products that sold at least 5 units in 30 days
    many(
      `SELECT p.name, p.size_label, SUM(ii.qty) AS units, SUM(ii.line_total) AS revenue,
              SUM(ii.line_total - ii.qty * ii.unit_cost) AS profit,
              ROUND(100 * SUM(ii.line_total - ii.qty * ii.unit_cost) / NULLIF(SUM(ii.line_total), 0), 1) AS margin_pct
         FROM invoice_items ii
         JOIN invoices i ON i.invoice_id = ii.invoice_id
         JOIN products p ON p.product_id = ii.product_id
        WHERE i.shop_id = $1 AND i.created_at >= now() - INTERVAL '30 days'
        GROUP BY p.product_id
       HAVING SUM(ii.qty) >= 5
        ORDER BY revenue DESC
        LIMIT 10`,
      [shop]
    ),
    many(
      `SELECT COALESCE(c.name, 'Uncategorised') AS category, SUM(ii.line_total) AS revenue
         FROM invoice_items ii
         JOIN invoices i ON i.invoice_id = ii.invoice_id
         JOIN products p ON p.product_id = ii.product_id
         LEFT JOIN categories c ON c.category_id = p.category_id
        WHERE i.shop_id = $1 AND i.created_at >= now() - INTERVAL '30 days'
        GROUP BY c.name ORDER BY revenue DESC`,
      [shop]
    ),
    many(
      `SELECT u.user_id, u.name, u.role, COUNT(i.invoice_id) AS bills, COALESCE(SUM(i.total), 0) AS revenue,
              ROUND(AVG(i.total), 2) AS avg_bill
         FROM users u
         LEFT JOIN invoices i ON i.staff_id = u.user_id AND i.created_at >= now() - INTERVAL '30 days'
        WHERE u.shop_id = $1 AND u.role IN ('owner', 'staff')
        GROUP BY u.user_id ORDER BY revenue DESC`,
      [shop]
    ),
    many(
      `SELECT payment_mode, COUNT(*) AS bills, SUM(total) AS amount
         FROM invoices WHERE shop_id = $1 AND created_at >= now() - INTERVAL '30 days'
        GROUP BY payment_mode ORDER BY amount DESC`,
      [shop]
    ),
    many('SELECT * FROM v_reorder_suggestions WHERE shop_id = $1 ORDER BY days_of_stock_left NULLS FIRST, name', [shop]),
    many(
      `SELECT customer_id, name, phone, current_balance, credit_limit, risk_score, risk_band, days_since_payment
         FROM v_customer_risk WHERE shop_id = $1 AND current_balance > 0 ORDER BY risk_rank LIMIT 6`,
      [shop]
    ),
    many('SELECT * FROM mv_monthly_sales WHERE shop_id = $1 ORDER BY month DESC LIMIT 6', [shop]),
    activityAnalytics(shop).catch((e) => {
      console.warn('[reports] mongo analytics failed:', e.message);
      return null;
    }),
  ]);

  // attach staff names to the Mongo leaderboard (users live in PostgreSQL)
  if (mongo?.staffLeaderboard) {
    const names = new Map(staff.map((u) => [u.user_id, u.name]));
    mongo.staffLeaderboard.forEach((r) => (r.name = names.get(r._id) || `User ${r._id}`));
    mongo.recent?.forEach((r) => (r.userName = names.get(r.userId) || null));
  }

  return { kpis, daily, topProducts, categories, staff, modes, reorder, risk, monthly, mongo };
});
