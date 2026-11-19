import { NextResponse, type NextRequest } from 'next/server';
import { openSession, sessionCookieName } from '@/lib/auth/session';

/**
 * First gate: pages and APIs need a valid session cookie. (Every API route also
 * checks it again itself; this just keeps signed-out visitors out early.)
 * No network calls here: the cookie is decrypted locally.
 */
const PUBLIC_PAGES = new Set(['/', '/login', '/auth/callback']);
const PUBLIC_API = [/^\/api\/auth\//, /^\/api\/health$/, /^\/api\/cron\//];

export async function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  if (PUBLIC_PAGES.has(pathname) || PUBLIC_API.some((r) => r.test(pathname))) return NextResponse.next();

  const session = await openSession(req.cookies.get(sessionCookieName())?.value).catch(() => null);
  if (session) return NextResponse.next();

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
