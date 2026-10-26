'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';

const NAV = {
  owner: [
    ['/billing', '🧾', 'Billing counter'],
    ['/inventory', '📦', 'Inventory'],
    ['/products', '🏷️', 'Products'],
    ['/customers', '📒', 'Udhaar khata'],
    ['/bill-scan', '📷', 'Scan supplier bill'],
    ['/reports', '📊', 'Reports'],
    ['/staff', '👥', 'Staff'],
  ],
  staff: [
    ['/billing', '🧾', 'Billing counter'],
    ['/inventory', '📦', 'Inventory'],
  ],
  customer: [['/my', '📒', 'My account']],
  admin: [['/admin', '🏪', 'Shops']],
};

export default function Shell({ user, children }) {
  const pathname = usePathname();
  const router = useRouter();

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.replace('/login');
    router.refresh();
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <b>
            Hisaab<span>.</span>
          </b>
        </div>
        {user.shopName && <div className="shopname">{user.shopName}</div>}
        <nav className="nav">
          {(NAV[user.role] || []).map(([href, icon, label]) => (
            <Link key={href} href={href} className={pathname.startsWith(href) ? 'active' : ''}>
              <span aria-hidden>{icon}</span>
              {label}
            </Link>
          ))}
        </nav>
        <div className="who">
          <b>{user.name}</b>
          <span className="badge grey" style={{ marginRight: 8 }}>
            {user.role}
          </span>
          <button className="small secondary" style={{ color: '#e8e3d6', borderColor: '#5b6478', marginTop: 8 }} onClick={logout}>
            Log out
          </button>
        </div>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
