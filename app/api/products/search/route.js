// Hybrid product search for the billing counter.
// The query is embedded in Node (transformers.js) and passed to fn_hybrid_search,
// which fuses full-text, trigram and vector rankings inside PostgreSQL.
import { handler, requireUser } from '@/lib/api';
import { many } from '@/lib/db';
import { embedOne, toPgVector } from '@/lib/embeddings';

export const GET = handler(async (request) => {
  const s = await requireUser(request, ['owner', 'staff']);
  const params = request.nextUrl.searchParams;
  const q = (params.get('q') || '').trim().slice(0, 80);
  const limit = Math.min(Math.max(parseInt(params.get('limit') || '8', 10) || 8, 1), 25);
  if (q.length < 2) return { results: [], semantic: false };

  const vec = await embedOne(q);
  const results = await many('SELECT * FROM fn_hybrid_search($1, $2, $3::vector, $4)', [
    s.shopId,
    q,
    toPgVector(vec),
    limit,
  ]);
  return { results, semantic: Boolean(vec) };
});
