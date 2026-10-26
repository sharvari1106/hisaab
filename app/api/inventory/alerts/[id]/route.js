import { handler, HttpError, requireUser } from '@/lib/api';
import { one } from '@/lib/db';
import { id } from '@/lib/validate';

// PATCH /api/inventory/alerts/:id  -> mark resolved
export const PATCH = handler(async (request, { params }) => {
  const s = await requireUser(request, ['owner', 'staff']);
  const row = await one(
    'UPDATE alerts SET is_resolved = TRUE WHERE alert_id = $1 AND shop_id = $2 RETURNING alert_id',
    [id((await params).id, 'Alert'), s.shopId]
  );
  if (!row) throw new HttpError(404, 'Alert not found.');
  return { ok: true };
});
