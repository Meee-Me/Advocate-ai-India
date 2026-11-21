import { createServerClient } from '@supabase/ssr';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { appUrl, supabaseAuthConfig } from '@/lib/config';
import { parseCookies, serializeCookie } from '@/lib/cookies';

/**
 * Supabase Auth, used only on the server.
 *
 * The browser never talks to Supabase Auth and never holds its tokens: sign-in, sign-up, password reset and sign-out
 * all go through this site's own routes, and the session lives in httpOnly cookies written here. Only the public
 * anon key is used (see supabaseAuthConfig); the service-role key is never given to the auth client.
 */

const secure = () => appUrl().startsWith('https://');
// On https the "__Host-" prefix makes the browser refuse the cookie unless it is Secure, host-only and Path=/.
const prefix = () => (secure() ? '__Host-advocate' : 'advocate');
export const authCookieName = () => `${prefix()}-auth`; // the session; the library adds ".0", ".1" ... when it is large
export const rememberCookieName = () => `${prefix()}-remember`; // "1" = keep me signed in, "0" = until the browser closes
export const recoveryCookieName = () => `${prefix()}-recovery`; // set only by a verified password-reset link

export const REMEMBER_MAX_AGE_S = 30 * 24 * 60 * 60;
export const RECOVERY_MAX_AGE_S = 15 * 60;

interface LibCookie { name: string; value: string; options: { maxAge?: number } & Record<string, unknown> }

/** One Set-Cookie line, with this site's security attributes forced on whatever the library asked for. */
export function setCookieLine(name: string, value: string, o: { maxAge?: number } = {}): string {
  return serializeCookie(name, value, { httpOnly: true, secure: secure(), sameSite: 'lax', path: '/', ...(o.maxAge === undefined ? {} : { maxAge: o.maxAge }) });
}

export const clearCookieLine = (name: string) => setCookieLine(name, '', { maxAge: 0 });

function libCookieLine(c: LibCookie, remember: boolean): string {
  const deleting = c.value === '' || (typeof c.options.maxAge === 'number' && c.options.maxAge <= 0);
  if (deleting) return clearCookieLine(c.name);
  // The PKCE code verifier is short-lived by design; the session follows "remember me".
  if (/code-verifier$/.test(c.name)) return setCookieLine(c.name, c.value, { maxAge: typeof c.options.maxAge === 'number' ? c.options.maxAge : 600 });
  return setCookieLine(c.name, c.value, remember ? { maxAge: REMEMBER_MAX_AGE_S } : {});
}

export function rememberCookieLine(remember: boolean): string {
  return setCookieLine(rememberCookieName(), remember ? '1' : '0', remember ? { maxAge: REMEMBER_MAX_AGE_S } : {});
}

export interface AuthContext {
  supabase: SupabaseClient;
  /** Set-Cookie lines produced so far (sign-in, token refresh, sign-out). The last write to a cookie wins. */
  setCookies(): string[];
  /** Headers the library wants on a response that sets session cookies (it must never be cached). */
  headers(): Record<string, string>;
}

/** A Supabase client bound to one request's cookies. Create a new one per request; never share it. */
export function authFor(req: Request, opts: { remember?: boolean } = {}): AuthContext {
  const cfg = supabaseAuthConfig();
  const jar = parseCookies(req.headers.get('cookie'));
  const remember = opts.remember ?? jar[rememberCookieName()] === '1';
  const written = new Map<string, string>();
  let extraHeaders: Record<string, string> = {};
  const supabase = createServerClient(cfg.url, cfg.anonKey, {
    cookieOptions: { name: authCookieName() },
    cookies: {
      getAll: () => Object.entries(jar).map(([name, value]) => ({ name, value })),
      setAll: (list, headers) => {
        for (const c of list as LibCookie[]) {
          written.set(c.name, libCookieLine(c, remember));
          if (c.value === '') delete jar[c.name]; else jar[c.name] = c.value;
        }
        extraHeaders = { ...extraHeaders, ...headers };
      },
    },
    // No background timers or URL parsing on the server: sessions are refreshed when a request needs them.
    auth: { autoRefreshToken: false, persistSession: true, detectSessionInUrl: false },
  });
  return { supabase, setCookies: () => [...written.values()], headers: () => extraHeaders };
}

/** Clears every cookie this site uses for authentication that came with the request. */
export function clearAuthCookies(req: Request): string[] {
  const names = Object.keys(parseCookies(req.headers.get('cookie')));
  const mine = (n: string) => n === authCookieName() || n.startsWith(`${authCookieName()}.`) || n === `${authCookieName()}-code-verifier`
    || n === rememberCookieName() || n === recoveryCookieName();
  return names.filter(mine).map(clearCookieLine);
}

export interface AuthUser {
  /** The Supabase user id. It is also the advocate's id in this site's database. */
  id: string;
  email: string;
  name: string;
}

export function toAuthUser(user: User): AuthUser {
  const email = user.email ?? '';
  const meta = user.user_metadata as { full_name?: unknown } | null;
  const named = typeof meta?.full_name === 'string' ? meta.full_name.trim() : '';
  return { id: user.id, email, name: named || email.split('@')[0] || 'Advocate' };
}

/** Adds cookies and cache headers to a response. */
export function withAuthCookies(res: Response, auth: AuthContext | null, extra: string[] = []): Response {
  for (const c of [...(auth?.setCookies() ?? []), ...extra]) res.headers.append('Set-Cookie', c);
  for (const [k, v] of Object.entries(auth?.headers() ?? {})) res.headers.set(k, v);
  if (auth || extra.length) res.headers.set('Cache-Control', 'no-store');
  return res;
}
