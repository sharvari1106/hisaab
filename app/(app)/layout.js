import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Shell from '@/components/Shell';
import { SESSION_COOKIE, verifySessionToken } from '@/lib/session';

// Server component: reads the signed session cookie and renders the role-specific shell.
export default async function AppLayout({ children }) {
  const store = await cookies();
  const session = await verifySessionToken(store.get(SESSION_COOKIE)?.value);
  if (!session) redirect('/login');
  return (
    <Shell user={{ name: session.name, role: session.role, shopName: session.shopName }}>{children}</Shell>
  );
}
