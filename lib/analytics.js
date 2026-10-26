// MongoDB aggregation pipelines over the activity log.
import { getMongo } from './mongo.js';

export async function activityAnalytics(shopId) {
  const db = await getMongo();
  if (!db) return null;
  const logs = db.collection('activity_logs');
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  // 1. Busy-hours heatmap: sales grouped by weekday x hour (Indian time)
  const heatmap = await logs
    .aggregate([
      { $match: { shopId, action: 'sale.create', at: { $gte: since } } },
      {
        $project: {
          dow: { $isoDayOfWeek: { date: '$at', timezone: 'Asia/Kolkata' } },
          hour: { $hour: { date: '$at', timezone: 'Asia/Kolkata' } },
          total: '$meta.total',
        },
      },
      { $group: { _id: { dow: '$dow', hour: '$hour' }, bills: { $sum: 1 }, revenue: { $sum: '$total' } } },
      { $project: { _id: 0, dow: '$_id.dow', hour: '$_id.hour', bills: 1, revenue: 1 } },
      { $sort: { dow: 1, hour: 1 } },
    ])
    .toArray();

  // 2. One pipeline, several reports: $facet
  const [facets] = await logs
    .aggregate([
      { $match: { shopId, at: { $gte: since } } },
      {
        $facet: {
          byAction: [{ $group: { _id: '$action', count: { $sum: 1 } } }, { $sort: { count: -1 } }],
          staffLeaderboard: [
            { $match: { action: 'sale.create' } },
            {
              $group: {
                _id: '$userId',
                bills: { $sum: 1 },
                revenue: { $sum: '$meta.total' },
                avgBill: { $avg: '$meta.total' },
                creditBills: { $sum: { $cond: [{ $eq: ['$meta.mode', 'credit'] }, 1, 0] } },
              },
            },
            { $sort: { revenue: -1 } },
          ],
          recent: [
            { $sort: { at: -1 } },
            { $limit: 12 },
            { $project: { _id: 0, action: 1, at: 1, userId: 1, meta: 1, entityId: 1 } },
          ],
        },
      },
    ])
    .toArray();

  // 3. Supplier-bill scan quality
  const [scanStats] = await db
    .collection('bill_scans')
    .aggregate([
      { $match: { shopId } },
      { $project: { lines: { $size: '$lines' }, matchedCount: 1, status: 1 } },
      {
        $group: {
          _id: null,
          scans: { $sum: 1 },
          lines: { $sum: '$lines' },
          matched: { $sum: '$matchedCount' },
          applied: { $sum: { $cond: [{ $eq: ['$status', 'applied'] }, 1, 0] } },
        },
      },
    ])
    .toArray();

  return { heatmap, ...facets, scanStats: scanStats || null };
}
