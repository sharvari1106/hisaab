import { handler, requireUser } from '@/lib/api';
import { query } from '@/lib/db';

// POST /api/reports/refresh (owner) - REFRESH MATERIALIZED VIEW CONCURRENTLY via procedure
export const POST = handler(async (request) => {
  await requireUser(request, ['owner']);
  const t0 = Date.now();
  await query('CALL sp_refresh_reports()');
  return { ok: true, ms: Date.now() - t0 };
});
