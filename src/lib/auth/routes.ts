import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { appUrl } from '@/lib/config';
import { parseCookies, serializeCookie } from '@/lib/cookies';
import { getDb } from '@/lib/db';
import { upsertFromDeluxe, getAdvocate } from '@/lib/db/repos/advocates';
import { HttpError } from '@/lib/http-errors';
import { clearSessionCookie, readSession, assertSameOrigin, requireSession } from './guard';
import { getAuthProvider, isAuthConfigured } from './provider';
import { cookieOptions, sealSession, SESSION_MAX_AGE_S, sessionCookieName, stateCookieName } from './session';

export function safeNext(value: string | null | undefined): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\') || value.includes('\n')) return '/dashboard';
  return value;
}

const eq = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

const redirect = (to: string, cookies: string[] = []) => {
  const h = new Headers({ Location: to });
  for (const c of cookies) h.append('Set-Cookie', c);
  return new Response(null, { status: 302, headers: h });
};

/** GET /api/auth/start: sends the browser to Deluxe Main. */
export async function startSignIn(req: Request): Promise<Response> {
  if (!isAuthConfigured()) return redirect(`${appUrl()}/login?error=not_configured`);
  const next = safeNext(new URL(req.url).searchParams.get('next'));
  // A random value that must come back with the code, so a code made for someone
  // else cannot be pushed into this browser ("login CSRF").
  const state = Buffer.from(crypto.getRandomValues(new Uint8Array(24))).toString('base64url');
  const returnUrl = `${appUrl()}/auth/callback?state=${state}`;
  const cookie = serializeCookie(stateCookieName(), JSON.stringify({ s: state, n: next }), cookieOptions(600));
  return redirect(getAuthProvider().startUrl(returnUrl), [cookie]);
}

const callbackBody = z.object({ code: z.string().min(1).max(200), state: z.string().min(1).max(200) });

/** POST /api/auth/callback: the page hands over the code Deluxe Main sent back. */
export async function completeSignIn(req: Request): Promise<Response> {
  assertSameOrigin(req);
  const body = callbackBody.parse(await req.json().catch(() => ({})));
  const raw = parseCookies(req.headers.get('cookie'))[stateCookieName()];
  let saved: { s: string; n: string } | null = null;
  try { saved = raw ? JSON.parse(raw) : null; } catch { saved = null; }
  const clearState = serializeCookie(stateCookieName(), '', { ...cookieOptions(0), maxAge: 0 });
  if (!saved || typeof saved.s !== 'string' || !eq(saved.s, body.state)) {
    throw new HttpError(400, 'That sign-in was not started from this browser. Please try again.', 'bad_state');
  }
  const { token, user } = await getAuthProvider().exchange(body.code);
  const advocate = await upsertFromDeluxe(await getDb(), user);
  const sealed = await sealSession({ aid: advocate.id, did: user.id, name: user.name, tok: token, chk: Date.now() });
  const session = serializeCookie(sessionCookieName(), sealed, cookieOptions(SESSION_MAX_AGE_S));
  return new Response(JSON.stringify({ ok: true, next: safeNext(saved.n) }), {
    status: 200,
    headers: [['Content-Type', 'application/json'], ['Set-Cookie', session], ['Set-Cookie', clearState]],
  });
}

/** POST /api/auth/logout */
export async function signOut(req: Request): Promise<Response> {
  assertSameOrigin(req);
  const session = await readSession(req);
  if (session) await getAuthProvider().logout(session.tok).catch(() => undefined);
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: [['Content-Type', 'application/json'], ['Set-Cookie', clearSessionCookie()]],
  });
}

/** GET /api/auth/me */
export async function whoAmI(req: Request): Promise<Response> {
  const auth = await requireSession(req);
  const advocate = await getAdvocate(await getDb(), auth.session.aid);
  if (!advocate) {
    return new Response(JSON.stringify({ error: 'Please sign in.', code: 'unauthorized' }), {
      status: 401,
      headers: [['Content-Type', 'application/json'], ['Set-Cookie', clearSessionCookie()]],
    });
  }
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (auth.setCookie) headers.append('Set-Cookie', auth.setCookie);
  return new Response(JSON.stringify({ advocate }), { status: 200, headers });
}
