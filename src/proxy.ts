import { NextResponse, type NextRequest } from 'next/server';
import { hasAuthCookie } from '@/lib/auth/supabase';

/**
 * First gate: pages and APIs need a sign-in cookie. Every API route and the app layout check it for real (Supabase
 * getUser) afterwards; this only keeps signed-out visitors out early. No network calls here.
 */
const PUBLIC_PAGES = new Set(['/', '/login', '/register', '/forgot-password', '/reset-password']);
const PUBLIC_API = [/^\/api\/auth\//, /^\/api\/health$/, /^\/api\/cron\//];

export async function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  if (PUBLIC_PAGES.has(pathname) || PUBLIC_API.some((r) => r.test(pathname))) return NextResponse.next();
  if (hasAuthCookie(req.cookies.getAll().map((c) => c.name))) return NextResponse.next();

  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Please sign in.', code: 'unauthorized' }, { status: 401 });
  }
  const login = new URL('/login', req.url);
  login.searchParams.set('next', pathname + search);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.svg|manifest.webmanifest|.*\\.(?:svg|png|jpg|ico|webp)$).*)'],
};
