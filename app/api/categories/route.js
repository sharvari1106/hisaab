import { handler, requireUser } from '@/lib/api';
import { many } from '@/lib/db';

export const GET = handler(async (request) => {
  await requireUser(request, ['owner', 'staff']);
  return { categories: await many('SELECT category_id, name FROM categories ORDER BY name') };
});
