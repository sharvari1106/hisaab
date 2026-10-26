import { handler, requireUser } from '@/lib/api';

export const GET = handler(async (request) => {
  const s = await requireUser(request);
  return { user: { id: s.uid, name: s.name, role: s.role, shopId: s.shopId, shopName: s.shopName, customerId: s.customerId } };
});
