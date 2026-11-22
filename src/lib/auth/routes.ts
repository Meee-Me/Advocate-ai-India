import { z } from 'zod';
import { appUrl } from '@/lib/config';
import { getDb } from '@/lib/db';
import { ensureAdvocate, getAdvocate, touchLastLogin } from '@/lib/db/repos/advocates';
import { HttpError, json, readBody } from '@/lib/http';
import { assertSameOrigin, requireSession } from './guard';
import { authFor, clearAuthCookies, rememberCookieLine, toAuthUser, withAuthCookies } from './supabase';
import { forgotSchema, loginSchema, registerSchema, resetSchema } from './validation';

const SMALL = 10_000;

/** Only same-site paths: stops "/login?next=https://evil" style redirects. */
export function safeNext(value: string | null | undefined): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\') || value.includes('\n')) return '/dashboard';
  return value;
}

/** Turns a Supabase Auth error into one message a person can act on, without saying which accounts exist. */
function failure(error: { name?: string; status?: number; code?: string } | null): HttpError {
  const status = error?.status ?? 0;
  if (error?.name === 'AuthRetryableFetchError' || status >= 500) return new HttpError(503, 'Sign-in is temporarily unavailable. Please try again in a moment.', 'auth_unavailable');
  if (status === 429 || error?.code === 'over_request_rate_limit' || error?.code === 'over_email_send_rate_limit') return new HttpError(429, 'Too many attempts. Please wait a few minutes and try again.', 'rate_limited');
  if (error?.code === 'email_not_confirmed') return new HttpError(403, 'Please confirm your email address first. Check your inbox for the link.', 'email_not_confirmed');
  if (error?.code === 'email_provider_disabled' || error?.code === 'signup_disabled') return new HttpError(503, 'Sign-up is switched off right now. Please contact the administrator.', 'signup_disabled');
  if (error?.code === 'user_already_exists') return new HttpError(409, 'This email already has an account. Please sign in instead.', 'already_registered');
  if (error?.code === 'weak_password') return new HttpError(400, 'That password is too weak. Use a longer one with letters and numbers.', 'weak_password');
  return new HttpError(401, 'Email or password is incorrect.', 'invalid_credentials');
}

const withNext = <T extends z.ZodRawShape>(s: z.ZodObject<T>) => s.extend({ next: z.string().max(500).optional() });

/** POST /api/auth/login */
export async function login(req: Request): Promise<Response> {
  assertSameOrigin(req);
  const b = await readBody(req, withNext(loginSchema), SMALL);
  const auth = authFor(req, { remember: b.remember });
  const { data, error } = await auth.supabase.auth.signInWithPassword({ email: b.email, password: b.password });
  if (error || !data.user) throw failure(error);
  const db = await getDb();
  const user = toAuthUser(data.user);
  await ensureAdvocate(db, user);
  await touchLastLogin(db, user.id);
  return withAuthCookies(json({ ok: true, next: safeNext(b.next) }), auth, [rememberCookieLine(b.remember)]);
}

/** POST /api/auth/register. With "Confirm email" off in Supabase the person is signed in straight away. */
export async function register(req: Request): Promise<Response> {
  assertSameOrigin(req);
  const b = await readBody(req, registerSchema, SMALL);
  const auth = authFor(req, { remember: false });
  const { data, error } = await auth.supabase.auth.signUp({
    email: b.email,
    password: b.password,
    options: { data: { full_name: b.fullName }, emailRedirectTo: `${appUrl()}/api/auth/confirm?next=/dashboard` },
  });
  if (error) throw failure(error);
  // A session exists only if the project has "Confirm email" switched off; otherwise a confirmation email was sent.
  if (data.session && data.user) {
    await ensureAdvocate(await getDb(), toAuthUser(data.user));
    return withAuthCookies(json({ ok: true, signedIn: true, next: '/dashboard' }), auth, [rememberCookieLine(false)]);
  }
  return json({ ok: true, signedIn: false });
}

/** POST /api/auth/logout */
export async function logout(req: Request): Promise<Response> {
  assertSameOrigin(req);
  const auth = authFor(req);
  await auth.supabase.auth.signOut().catch(() => undefined);
  return withAuthCookies(json({ ok: true }), null, clearAuthCookies(req));
}

/** POST /api/auth/forgot. Always answers the same, so it cannot be used to find out who has an account. */
export async function forgot(req: Request): Promise<Response> {
  assertSameOrigin(req);
  const b = await readBody(req, forgotSchema, SMALL);
  const auth = authFor(req);
  const { error } = await auth.supabase.auth.resetPasswordForEmail(b.email, { redirectTo: `${appUrl()}/api/auth/confirm?next=/reset-password` });
  if (error && (error.status ?? 0) >= 500) throw failure(error);
  return withAuthCookies(json({ ok: true }), auth);
}

/** GET /api/auth/confirm: the link in a confirmation or password-reset email lands here with a one-use code. */
export async function confirm(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const code = url.searchParams.get('code') ?? '';
  const auth = authFor(req);
  const { data, error } = code ? await auth.supabase.auth.exchangeCodeForSession(code) : { data: null, error: new Error('no code') };
  const to = error || !data?.user ? '/login?error=link' : safeNext(url.searchParams.get('next'));
  if (data?.user) await ensureAdvocate(await getDb(), toAuthUser(data.user));
  return withAuthCookies(new Response(null, { status: 302, headers: { Location: `${appUrl()}${to}` } }), auth);
}

/** POST /api/auth/reset: sets a new password for the person who just followed a reset link (they are signed in by it). */
export async function reset(req: Request): Promise<Response> {
  assertSameOrigin(req);
  const b = await readBody(req, resetSchema, SMALL);
  const auth = authFor(req);
  await requireSession(req, auth);
  const { error } = await auth.supabase.auth.updateUser({ password: b.password });
  if (error) throw failure(error);
  return withAuthCookies(json({ ok: true }), auth);
}

/** GET /api/auth/me */
export async function whoAmI(req: Request): Promise<Response> {
  const auth = await requireSession(req);
  const db = await getDb();
  await ensureAdvocate(db, auth.user);
  const advocate = await getAdvocate(db, auth.session.aid);
  return withAuthCookies(json({ advocate }), null, auth.setCookies);
}
