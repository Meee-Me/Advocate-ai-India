import { HttpError } from '@/lib/http-errors';
import { parseCookies, serializeCookie } from '@/lib/cookies';
import { getAuthProvider } from './provider';
import { cookieOptions, openSession, REVALIDATE_AFTER_MS, sealSession, SESSION_MAX_AGE_S, sessionCookieName, type SessionData } from './session';

export interface AuthedSession {
  session: SessionData;
  /** A refreshed session cookie to send back, when Deluxe Main was re-checked. */
  setCookie?: string;
}

export function clearSessionCookie(): string {
  return serializeCookie(sessionCookieName(), '', { ...cookieOptions(0), maxAge: 0 });
}

export async function readSession(req: Request): Promise<SessionData | null> {
  return openSession(parseCookies(req.headers.get('cookie'))[sessionCookieName()]);
}

/**
 * Requires a signed-in advocate. Every 15 minutes the key is re-checked with
 * Deluxe Main, so signing out there (or changing the password) ends access here.
 */
export async function requireSession(req: Request): Promise<AuthedSession> {
  const session = await readSession(req);
  if (!session) throw new HttpError(401, 'Please sign in.', 'unauthorized');
  if (Date.now() - session.chk < REVALIDATE_AFTER_MS) return { session };

  let user;
  try {
    user = await getAuthProvider().validate(session.tok);
  } catch (error) {
    // Deluxe Main is unreachable: keep working on the existing session rather
    // than locking advocates out of their cases during someone else's outage.
    console.error('Deluxe Main re-check failed:', error instanceof Error ? error.message : 'unknown');
    return { session };
  }
  if (!user || user.id !== session.did) {
    throw new HttpError(401, 'Your Deluxe Main sign-in has ended. Please sign in again.', 'unauthorized');
  }
  const next: SessionData = { ...session, name: user.name, chk: Date.now() };
  return { session: next, setCookie: serializeCookie(sessionCookieName(), await sealSession(next), cookieOptions(SESSION_MAX_AGE_S)) };
}

/**
 * CSRF defence for state-changing requests, on top of SameSite=Lax cookies:
 * the browser must say the request comes from this very site.
 */
export function assertSameOrigin(req: Request): void {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return;
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  const origin = req.headers.get('origin');
  if (origin) {
    let ok = false;
    try { ok = new URL(origin).host === host; } catch { /* malformed */ }
    if (!ok) throw new HttpError(403, 'Cross-site requests are not allowed.', 'csrf');
    return;
  }
  const site = req.headers.get('sec-fetch-site');
  if (site === 'same-origin' || site === 'none') return;
  throw new HttpError(403, 'Cross-site requests are not allowed.', 'csrf');
}
