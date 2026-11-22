import { ConfigError } from '@/lib/config';
import { HttpError } from '@/lib/http-errors';
import { authFor, clearAuthCookies, toAuthUser, type AuthContext, type AuthUser } from './supabase';

export interface AuthedSession {
  /** `aid` is the advocate's id in this site's database: it is the Supabase user id. */
  session: { aid: string; name: string; email: string };
  user: AuthUser;
  /** Set-Cookie lines (a refreshed session) and headers to send back with the response. */
  setCookies: string[];
  headers: Record<string, string>;
}

/**
 * Requires a signed-in advocate.
 *
 * The user is checked with Supabase Auth on every request (getUser), not just read from the cookie, so a session that
 * was signed out, revoked or deleted stops working immediately. An expired access token is refreshed here and the new
 * cookies are returned for the response.
 */
export async function requireSession(req: Request, auth: AuthContext = authFor(req)): Promise<AuthedSession> {
  const { data, error } = await auth.supabase.auth.getUser();
  if (error || !data.user) {
    // Supabase Auth itself unreachable or failing: say so, and keep the person's cookies (do not sign them out).
    const status = (error as { status?: number } | null)?.status ?? 0;
    if (error && (error.name === 'AuthRetryableFetchError' || status >= 500)) {
      throw new HttpError(503, 'Sign-in is temporarily unavailable. Please try again in a moment.', 'auth_unavailable');
    }
    const stale = error && error.name !== 'AuthSessionMissingError' ? clearAuthCookies(req) : [];
    throw new HttpError(401, 'Please sign in.', 'unauthorized').withCookies(stale);
  }
  const user = toAuthUser(data.user);
  return { session: { aid: user.id, name: user.name, email: user.email }, user, setCookies: auth.setCookies(), headers: auth.headers() };
}

/** For callers that only want to know who is signed in, without failing. */
export async function optionalSession(req: Request): Promise<AuthedSession | null> {
  try {
    return await requireSession(req);
  } catch (error) {
    if (error instanceof HttpError && error.status === 401) return null;
    if (error instanceof ConfigError) return null;
    throw error;
  }
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
