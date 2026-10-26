import { handler, requireUser } from '@/lib/api';
import { getPool } from '@/lib/db';
import { reembedProducts } from '@/lib/products';

// POST /api/products/reembed (owner) - recompute every product vector of this shop
export const POST = handler(async (request) => {
  const s = await requireUser(request, ['owner']);
  const count = await reembedProducts(getPool(), { shopId: s.shopId });
  return {
    embedded: count,
    message: count ? `Embedded ${count} products.` : 'Embedding model unavailable - search will use text and fuzzy matching only.',
  };
});
