import { handler, requireUser } from '@/lib/api';
import { one } from '@/lib/db';
import { logActivity } from '@/lib/mongo';

// POST /api/inventory/write-off  (owner) - CALL the stored procedure
export const POST = handler(async (request) => {
  const s = await requireUser(request, ['owner']);
  const r = await one('CALL sp_write_off_expired($1, $2, NULL, NULL)', [s.shopId, s.uid]);
  logActivity({ shopId: s.shopId, userId: s.uid, role: s.role, action: 'stock.write_off', meta: r });
  return { batches: r.p_batches, units: r.p_units };
});
