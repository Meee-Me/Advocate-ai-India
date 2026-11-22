import { beforeAll, describe, expect, it } from 'vitest';
import * as raw from '@/lib/auth/routes';
import { open } from '@/lib/http';
import * as cases from '@/app/api/cases/route';
import { registerSchema, passwordProblems } from '@/lib/auth/validation';
import { call, setup, signIn } from './harness';
import { fakeCodes, fakeUsers } from './fake-supabase';

// Wrapped exactly as the real route files do, so thrown HttpErrors become responses.
const routes = { safeNext: raw.safeNext, register: open(raw.register), login: open(raw.login), logout: open(raw.logout), confirm: open(raw.confirm), reset: open(raw.reset), whoAmI: open(raw.whoAmI) };
const post = (h: Parameters<typeof call>[0], path: string, body: unknown, headers?: Record<string, string>) => call(h, 'POST', path, { body, headers });
const cookieOf = (res: Response, name: string) => res.headers.getSetCookie().find((c) => c.startsWith(`${name}=`));

describe('own sign-in (Supabase Auth)', () => {
  beforeAll(async () => { await setup(); });

  it('password rules: 10+ characters with a letter and a number', () => {
    expect(passwordProblems('short1')).toHaveLength(1);
    expect(passwordProblems('onlyletterslong')).toEqual(['at least one number']);
    expect(passwordProblems('correct-horse-9')).toEqual([]);
    expect(registerSchema.safeParse({ fullName: 'A B', username: 'ab.in', password: 'correct-horse-9', confirmPassword: 'different-9999', acknowledged: true }).success).toBe(false);
    const ok = { fullName: 'A B', username: 'ab.in', password: 'correct-horse-9', confirmPassword: 'correct-horse-9' };
    expect(registerSchema.safeParse({ ...ok, acknowledged: true }).success).toBe(true);
    expect(registerSchema.safeParse(ok).success).toBe(false); // the warning must be acknowledged
    expect(registerSchema.safeParse({ ...ok, acknowledged: false }).success).toBe(false);
  });

  it('only same-site paths are accepted after sign-in', () => {
    expect(routes.safeNext('/cases')).toBe('/cases');
    for (const bad of ['https://evil.example', '//evil.example', '/\\evil', null]) expect(routes.safeNext(bad as string)).toBe('/dashboard');
  });

  it('sign-up signs the person in at once; a taken username is refused clearly', async () => {
    const body = { fullName: 'Asha Menon', username: 'Asha.Menon', password: 'correct-horse-9', confirmPassword: 'correct-horse-9', acknowledged: true };
    const a = await post(routes.register, '/api/auth/register', body);
    expect(a.status).toBe(200);
    expect(a.data).toEqual({ ok: true, signedIn: true, next: '/dashboard' });
    expect(cookieOf(a.res, 'advocate-auth')).toMatch(/HttpOnly/);
    expect(fakeUsers.get('asha.menon@users.advocate-ai.invalid')).toBeTruthy(); // usernames are case-insensitive
    const b = await post(routes.register, '/api/auth/register', body);
    expect(b.status).toBe(409);
    expect(b.data.error).toContain('already taken');
    expect((await post(routes.register, '/api/auth/register', { ...body, username: 'a b' })).status).toBe(400);
  });

  it('signs in with a username and password, creates the profile row, ignores a hostile next', async () => {
    const creds = { username: 'ASHA.menon', password: 'correct-horse-9' };
    const ok = await post(routes.login, '/api/auth/login', { ...creds, remember: true, next: '//evil.example' });
    expect(ok.status).toBe(200);
    expect(ok.data).toEqual({ ok: true, next: '/dashboard' });
    expect(cookieOf(ok.res, 'advocate-auth')).toMatch(/HttpOnly/);
    expect(cookieOf(ok.res, 'advocate-remember')).toContain('=1');
    const u = fakeUsers.get('asha.menon@users.advocate-ai.invalid')!;
    fakeCodes.set('code-1', u.id);
    const link = await call(routes.confirm, 'GET', '/api/auth/confirm?code=code-1&next=/cases', { raw: true });
    expect(link.res.headers.get('location')).toBe('http://localhost:3999/cases');
  });

  it('wrong password and unknown username give the same answer', async () => {
    const wrong = await post(routes.login, '/api/auth/login', { username: 'asha.menon', password: 'nope-nope-nope-1' });
    const unknown = await post(routes.login, '/api/auth/login', { username: 'nobody', password: 'nope-nope-nope-1' });
    expect([wrong.status, unknown.status]).toEqual([401, 401]);
    expect(wrong.data).toEqual(unknown.data);
  });

  it('reset needs a signed-in (link) session, then changes the password', async () => {
    const body = { password: 'brand-new-pass-1', confirmPassword: 'brand-new-pass-1' };
    expect((await post(routes.reset, '/api/auth/reset', body)).status).toBe(401);
    const who = await signIn('Ravi');
    expect((await call(routes.reset, 'POST', '/api/auth/reset', { who, body })).status).toBe(200);
    expect(fakeUsers.get('ravi@users.advocate-ai.invalid')!.password).toBe('brand-new-pass-1');
  });

  it('refuses cross-site posts and unauthenticated API calls', async () => {
    const x = await call(routes.login, 'POST', '/api/auth/login', { body: { username: 'ab.in', password: 'x' }, headers: { origin: 'https://evil.example' } });
    expect(x.status).toBe(403);
    expect((await call(cases.GET, 'GET', '/api/cases')).status).toBe(401);
  });

  it('signed-in people reach their API and /me; sign-out clears the cookie', async () => {
    const who = await signIn('Meera');
    expect((await call(cases.GET, 'GET', '/api/cases', { who })).status).toBe(200);
    const me = await call(routes.whoAmI, 'GET', '/api/auth/me', { who });
    expect(me.data.advocate).toMatchObject({ id: who.id, displayName: 'Meera' });
    const out = await call(routes.logout, 'POST', '/api/auth/logout', { who, body: {} });
    expect(cookieOf(out.res, 'advocate-auth')).toContain('Max-Age=0');
  });
});
