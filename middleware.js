// Page-level access control. API routes do their own checks with requireUser().
import { NextResponse } from 'next/server';
import { PAGE_ROLES, ROLE_HOME, SESSION_COOKIE, verifySessionToken } from './lib/session.js';

export async function middleware(request) {
  const { pathname } = request.nextUrl;
  const session = await verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value);

  if (pathname === '/login') {
    if (session) return NextResponse.redirect(new URL(ROLE_HOME[session.role] || '/', request.url));
    return NextResponse.next();
  }

  if (!session) {
    const url = new URL('/login', request.url);
    if (pathname !== '/') url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }

  if (pathname === '/') {
    return NextResponse.redirect(new URL(ROLE_HOME[session.role] || '/login', request.url));
  }

  const rule = PAGE_ROLES.find((r) => pathname === r.prefix || pathname.startsWith(r.prefix + '/'));
  if (rule && !rule.roles.includes(session.role)) {
    return NextResponse.redirect(new URL(ROLE_HOME[session.role], request.url));
  }
  return NextResponse.next();
}

export const config = {
  // everything except API routes, Next.js internals and static files
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:png|svg|ico|jpg)$).*)'],
};
