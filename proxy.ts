/** Route protection (Next.js 16 "proxy", formerly middleware). */
import { NextRequest, NextResponse } from 'next/server';
import { COOKIE, verifySession } from '@/lib/auth/session';
import { canView } from '@/lib/auth/permissions';

export async function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const s = await verifySession(req.cookies.get(COOKIE)?.value);
  if (pathname.startsWith('/app')) {
    if (!s) return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent(pathname + search)}`, req.url));
    if (!canView(s.role, pathname)) return NextResponse.redirect(new URL('/app/resupply', req.url));
  }
  if (pathname === '/login' && s) return NextResponse.redirect(new URL(s.role === 'SUPPLIER' ? '/app/resupply' : '/app', req.url));
  return NextResponse.next();
}

export const config = { matcher: ['/app/:path*', '/login'] };
