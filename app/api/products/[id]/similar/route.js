// "Out of stock? Offer a substitute" - nearest neighbours in embedding space
import { handler, HttpError, requireUser } from '@/lib/api';
import { many, one } from '@/lib/db';
import { id } from '@/lib/validate';

export const GET = handler(async (request, { params }) => {
  const s = await requireUser(request, ['owner', 'staff']);
  const productId = id((await params).id, 'Product');
  const owner = await one('SELECT shop_id FROM products WHERE product_id = $1', [productId]);
  if (!owner || owner.shop_id !== s.shopId) throw new HttpError(404, 'Product not found.');
  const results = await many('SELECT * FROM fn_similar_products($1, 5)', [productId]);
  return { results };
});
