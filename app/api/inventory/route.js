import { handler, HttpError, requireUser } from '@/lib/api';
import { many } from '@/lib/db';

// GET /api/inventory?view=stock|expiring|alerts|movements
export const GET = handler(async (request) => {
  const s = await requireUser(request, ['owner', 'staff']);
  const view = request.nextUrl.searchParams.get('view') || 'stock';

  switch (view) {
    case 'stock':
      return {
        rows: await many(
          `SELECT product_id, name, brand, size_label, category, selling_price, reorder_level,
                  stock, expired_qty, nearest_expiry, stock_value, status
             FROM v_product_stock WHERE shop_id = $1 AND is_active
            ORDER BY CASE status WHEN 'OUT' THEN 0 WHEN 'LOW' THEN 1 ELSE 2 END, name`,
          [s.shopId]
        ),
      };
    case 'expiring':
      return { rows: await many('SELECT * FROM v_expiring_soon WHERE shop_id = $1 ORDER BY days_left, name', [s.shopId]) };
    case 'alerts':
      return {
        rows: await many(
          `SELECT a.alert_id, a.kind, a.message, a.created_at, p.name
             FROM alerts a JOIN products p ON p.product_id = a.product_id
            WHERE a.shop_id = $1 AND NOT a.is_resolved
            ORDER BY a.created_at DESC`,
          [s.shopId]
        ),
      };
    case 'movements':
      return {
        rows: await many(
          `SELECT m.movement_id, m.created_at, m.reason, m.change_qty, m.ref_id, p.name, b.batch_no, u.name AS by_user
             FROM stock_movements m
             JOIN batches b  ON b.batch_id = m.batch_id
             JOIN products p ON p.product_id = b.product_id
             LEFT JOIN users u ON u.user_id = m.created_by
            WHERE p.shop_id = $1
            ORDER BY m.created_at DESC, m.movement_id DESC
            LIMIT 100`,
          [s.shopId]
        ),
      };
    default:
      throw new HttpError(400, 'Unknown view.');
  }
});
