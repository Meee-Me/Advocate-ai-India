import { spawn, type ChildProcess } from 'node:child_process';
import { pbkdf2Sync, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { completeSignIn, safeNext, signOut, startSignIn, whoAmI } from '@/lib/auth/routes';
import { requireSession, assertSameOrigin } from '@/lib/auth/guard';
import { openSession, sealSession, sessionCookieName, stateCookieName } from '@/lib/auth/session';
import { getAuthProvider } from '@/lib/auth/provider';
import { parseCookies } from '@/lib/cookies';
import { freshDb } from './helpers';

const APP = 'http://localhost:3999';
const setEnv = (main: string) => {
  Object.assign(process.env, {
    APP_URL: APP, SESSION_SECRET: 'x'.repeat(48), DELUXE_MAIN_URL: main, DELUXE_APP_ID: 'advocate', AUTH_PROVIDER: 'deluxe',
  });
};

/** Pulls "name=value" pairs out of Set-Cookie headers into a Cookie header. */
const cookieHeader = (res: Response, extra: Record<string, string> = {}) => {
  const jar: Record<string, string> = { ...extra };
  for (const c of res.headers.getSetCookie()) {
    const [pair] = c.split(';');
    const i = pair.indexOf('=');
    const v = decodeURIComponent(pair.slice(i + 1));
    if (/Max-Age=0/i.test(c)) delete jar[pair.slice(0, i)]; else jar[pair.slice(0, i)] = v;
  }
  return Object.entries(jar).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('; ');
};
const post = (path: string, body: unknown, cookie = '') =>
  new Request(APP + path, { method: 'POST', headers: { 'content-type': 'application/json', host: 'localhost:3999', origin: APP, cookie }, body: JSON.stringify(body) });

describe('safeNext', () => {
  it('only allows same-site relative paths', () => {
    expect(safeNext('/cases?x=1')).toBe('/cases?x=1');
    for (const bad of ['//evil.com', 'https://evil.com', '/\\evil.com', 'javascript:alert(1)', '', null]) expect(safeNext(bad as string)).toBe('/dashboard');
  });
});

describe('CSRF check', () => {
  const req = (h: Record<string, string>, method = 'POST') => new Request(APP + '/api/x', { method, headers: { host: 'localhost:3999', ...h } });
  it('accepts same-origin, rejects cross-site and header-less writes', () => {
    expect(() => assertSameOrigin(req({ origin: APP }))).not.toThrow();
    expect(() => assertSameOrigin(req({ 'sec-fetch-site': 'same-origin' }))).not.toThrow();
    expect(() => assertSameOrigin(req({}, 'GET'))).not.toThrow();
    expect(() => assertSameOrigin(req({ origin: 'https://evil.example' }))).toThrow();
    expect(() => assertSameOrigin(req({ 'sec-fetch-site': 'cross-site' }))).toThrow();
    expect(() => assertSameOrigin(req({}))).toThrow();
  });
});

describe('session cookie', () => {
  beforeEach(() => setEnv('http://localhost:1'));
  it('round-trips, is opaque, and rejects tampering or another secret', async () => {
    const sealed = await sealSession({ aid: 'a', did: 'd', name: 'N', tok: 'secret-token-value', chk: 1 });
    expect(sealed).not.toContain('secret-token-value');
    expect((await openSession(sealed))?.tok).toBe('secret-token-value');
    expect(await openSession(sealed.slice(0, -3) + 'abc')).toBeNull();
    process.env.SESSION_SECRET = 'y'.repeat(48);
    expect(await openSession(sealed)).toBeNull();
    expect(await openSession('garbage')).toBeNull();
    expect(await openSession(undefined)).toBeNull();
  });
});

/** A stand-in Deluxe Main, following the documented protocol, for failure cases. */
function mockMain(handler: (req: http.IncomingMessage, body: string) => [number, unknown]) {
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const [status, data] = handler(req, body);
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(data));
    });
  });
  return new Promise<{ url: string; close: () => void }>((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${(server.address() as { port: number }).port}`, close: () => server.close() })));
}

describe('sign-in flow with a mock Deluxe Main', () => {
  let main: Awaited<ReturnType<typeof mockMain>>;
  const seen: { origin?: string; auth?: string }[] = [];
  let meStatus = 200;
  beforeAll(async () => {
    main = await mockMain((req, body) => {
      seen.push({ origin: req.headers.origin, auth: req.headers.authorization });
      if (req.url === '/api/connect/exchange') {
        return JSON.parse(body).code === 'a'.repeat(48)
          ? [200, { token: 'dm_' + 'z'.repeat(40), app: 'advocate', expiresIn: 1e6, user: { id: 'u_1', name: 'Asha Rao', handle: 'asha.rao' } }]
          : JSON.parse(body).code === 'b'.repeat(48)
            ? [200, { token: 'dm_' + 'z'.repeat(40), app: 'docs', user: { id: 'u_1', name: 'Asha Rao' } }]
            : [400, { error: 'expired' }];
      }
      if (req.url === '/api/auth/me') return meStatus === 200 ? [200, { user: { id: 'u_1', name: 'Asha R.', handle: 'asha.rao' } }] : [meStatus, {}];
      return [404, {}];
    });
  });
  afterAll(() => main.close());
  beforeEach(async () => { setEnv(main.url); await freshDb(); seen.length = 0; meStatus = 200; });

  const begin = async () => {
    const start = await startSignIn(new Request(APP + '/api/auth/start?next=/cases'));
    const to = new URL(start.headers.get('location')!);
    const ret = new URL(to.searchParams.get('return')!);
    return { start, to, state: ret.searchParams.get('state')!, cookie: cookieHeader(start) };
  };

  it('start redirects to Deluxe Main /connect with return + app and sets a state cookie', async () => {
    const { start, to, state } = await begin();
    expect(start.status).toBe(302);
    expect(to.origin).toBe(main.url);
    expect(to.pathname).toBe('/connect');
    expect(to.searchParams.get('app')).toBe('advocate');
    expect(to.searchParams.get('return')).toBe(`${APP}/auth/callback?state=${state}`);
    expect(start.headers.getSetCookie()[0]).toMatch(/HttpOnly/);
  });

  it('completes sign-in: sends the site origin, creates the advocate, seals the session', async () => {
    const { state, cookie } = await begin();
    const res = await completeSignIn(post('/api/auth/callback', { code: 'a'.repeat(48), state }, cookie));
    expect(res.status).toBe(200);
    expect((await res.json()).next).toBe('/cases');
    expect(seen[0].origin).toBe(APP);
    const jar = cookieHeader(res);
    const session = await openSession(parseCookies(jar)[sessionCookieName()]);
    expect(session).toMatchObject({ did: 'u_1', name: 'Asha Rao' });
    expect(parseCookies(jar)[stateCookieName()]).toBeUndefined(); // state is single-use
    const me = await whoAmI(new Request(APP + '/api/auth/me', { headers: { cookie: jar } }));
    expect((await me.json()).advocate.displayName).toBe('Asha Rao');
  });

  it('signing in twice reuses the same advocate', async () => {
    for (let i = 0; i < 2; i++) {
      const { state, cookie } = await begin();
      await completeSignIn(post('/api/auth/callback', { code: 'a'.repeat(48), state }, cookie));
    }
    const { getDb } = await import('@/lib/db');
    const rows = await (await getDb()).query.advocates.findMany();
    expect(rows).toHaveLength(1);
  });

  it('rejects a wrong or missing state (login CSRF), cross-site posts, bad codes, and the wrong app', async () => {
    const { state, cookie } = await begin();
    await expect(completeSignIn(post('/api/auth/callback', { code: 'a'.repeat(48), state: 'nope' }, cookie))).rejects.toMatchObject({ status: 400 });
    await expect(completeSignIn(post('/api/auth/callback', { code: 'a'.repeat(48), state }, ''))).rejects.toMatchObject({ status: 400 });
    const evil = new Request(APP + '/api/auth/callback', { method: 'POST', headers: { host: 'localhost:3999', origin: 'https://evil.example', cookie, 'content-type': 'application/json' }, body: JSON.stringify({ code: 'a'.repeat(48), state }) });
    await expect(completeSignIn(evil)).rejects.toMatchObject({ status: 403 });
    const b = await begin();
    await expect(completeSignIn(post('/api/auth/callback', { code: 'c'.repeat(48), state: b.state }, b.cookie))).rejects.toMatchObject({ status: 400 });
    await expect(completeSignIn(post('/api/auth/callback', { code: 'short', state: b.state }, b.cookie))).rejects.toMatchObject({ status: 400 });
    const w = await begin();
    await expect(completeSignIn(post('/api/auth/callback', { code: 'b'.repeat(48), state: w.state }, w.cookie))).rejects.toMatchObject({ status: 502 });
  });

  it('re-checks with Deluxe Main after 15 minutes and ends the session when Main ends the key', async () => {
    const { state, cookie } = await begin();
    const res = await completeSignIn(post('/api/auth/callback', { code: 'a'.repeat(48), state }, cookie));
    const old = await openSession(parseCookies(cookieHeader(res))[sessionCookieName()]);
    const stale = await sealSession({ ...old!, chk: Date.now() - 16 * 60 * 1000 });
    const mk = (v: string) => new Request(APP + '/api/x', { headers: { cookie: `${sessionCookieName()}=${encodeURIComponent(v)}` } });

    const ok = await requireSession(mk(stale));
    expect(ok.setCookie).toBeTruthy();
    expect(ok.session.name).toBe('Asha R.'); // refreshed from Main
    expect(seen.at(-1)?.auth).toMatch(/^Bearer dm_/);

    meStatus = 401;
    await expect(requireSession(mk(stale))).rejects.toMatchObject({ status: 401 });
    meStatus = 503; // Main down: stay signed in
    expect((await requireSession(mk(stale))).session.did).toBe('u_1');
    expect((await requireSession(mk(await sealSession({ ...old!, chk: Date.now() })))).setCookie).toBeUndefined(); // fresh: no call
  });

  it('logout clears the cookie', async () => {
    const res = await signOut(post('/api/auth/logout', {}));
    expect(res.headers.getSetCookie()[0]).toMatch(/Max-Age=0/);
  });

  it('reports a clear error when Deluxe Main is unreachable', async () => {
    process.env.DELUXE_MAIN_URL = 'http://127.0.0.1:9';
    const { state, cookie } = await begin();
    await expect(getAuthProvider().exchange('a'.repeat(48))).rejects.toMatchObject({ status: 503 });
    expect(state && cookie).toBeTruthy();
  });
});

describe('unconfigured and dev providers', () => {
  it('sends people to /login?error=not_configured when Deluxe Main is not configured', async () => {
    Object.assign(process.env, { APP_URL: APP, SESSION_SECRET: 'x'.repeat(48), AUTH_PROVIDER: 'deluxe' });
    delete process.env.DELUXE_MAIN_URL;
    const res = await startSignIn(new Request(APP + '/api/auth/start'));
    expect(res.headers.get('location')).toBe(`${APP}/login?error=not_configured`);
  });
  it('refuses the dev provider in production', () => {
    Object.assign(process.env, { AUTH_PROVIDER: 'dev', VERCEL_ENV: 'production' });
    expect(() => getAuthProvider()).toThrow(/local development only/);
    delete process.env.VERCEL_ENV;
    process.env.AUTH_PROVIDER = 'deluxe';
  });
});

/* The same flow against Deluxe Main's real server code, when its repository is next to this one. */
const mainDir = process.env.DELUXE_MAIN_DIR ?? path.resolve(process.cwd(), '..', 'Deluxe-Main');
const haveMain = fs.existsSync(path.join(mainDir, 'tests', 'dev-server.mjs'))
  && fs.readFileSync(path.join(mainDir, 'worker', 'apps.js'), 'utf8').includes('advocate:');

describe.skipIf(!haveMain)('sign-in against the real Deluxe Main server', () => {
  let proc: ChildProcess;
  const PORT = 8791;
  const MAIN = `http://localhost:${PORT}`;
  beforeAll(async () => {
    proc = spawn('node', ['tests/dev-server.mjs', String(PORT)], { cwd: mainDir, env: { ...process.env, ALLOW_LOCALHOST: '1' } });
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('Deluxe Main did not start')), 15000);
      proc.stdout!.on('data', (d) => { if (String(d).includes('dev server')) { clearTimeout(t); resolve(); } });
      proc.on('error', reject);
    });
  });
  afterAll(() => { proc?.kill(); });

  it('full handshake: account -> approve -> code -> exchange -> session -> revalidate -> sign out', async () => {
    setEnv(MAIN);
    await freshDb();
    const call = async (method: string, p: string, body?: unknown, token?: string) => {
      const r = await fetch(MAIN + p, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
      return { status: r.status, data: await r.json().catch(() => ({})) };
    };
    // A person creates their Deluxe account (the browser hashes the password).
    const salt = randomBytes(16).toString('hex');
    const hash = pbkdf2Sync('hunter22', Buffer.from(salt, 'hex'), 120000, 32, 'sha256').toString('hex');
    const acct = await call('POST', '/api/accounts', { name: 'Meera Nair', salt, hash });
    expect(acct.status).toBe(201);

    // Our site sends them to Deluxe Main, which asks them to continue, then returns a code.
    const start = await startSignIn(new Request(APP + '/api/auth/start?next=/cases'));
    const connect = new URL(start.headers.get('location')!);
    expect(connect.origin + connect.pathname).toBe(`${MAIN}/connect`);
    const returnUrl = connect.searchParams.get('return')!;
    const check = await call('POST', '/api/connect/check', { return: returnUrl, app: 'advocate' }, acct.data.token);
    expect(check.data).toMatchObject({ app: 'advocate', origin: APP });
    const approve = await call('POST', '/api/connect/approve', { return: returnUrl, app: 'advocate' }, acct.data.token);
    const back = new URL(approve.data.redirect);
    const code = /deluxe_code=([0-9a-f]{48})/.exec(back.hash)![1];
    expect(back.searchParams.get('state')).toBe(new URL(returnUrl).searchParams.get('state'));

    // The callback page hands the code to our server.
    const done = await completeSignIn(post('/api/auth/callback', { code, state: back.searchParams.get('state') }, cookieHeader(start)));
    expect(done.status).toBe(200);
    const jar = cookieHeader(done);
    const session = await openSession(parseCookies(jar)[sessionCookieName()]);
    expect(session?.name).toBe('Meera Nair');
    expect(session?.did).toBe(acct.data.user.id);

    // A code works once.
    const s2 = await startSignIn(new Request(APP + '/api/auth/start'));
    await expect(completeSignIn(post('/api/auth/callback', { code, state: new URL(new URL(s2.headers.get('location')!).searchParams.get('return')!).searchParams.get('state') }, cookieHeader(s2)))).rejects.toMatchObject({ status: 400 });

    // Revalidation succeeds, then fails after the person signs this site out.
    const stale = await sealSession({ ...session!, chk: 0 });
    const mk = (v: string) => new Request(APP + '/api/x', { headers: { cookie: `${sessionCookieName()}=${encodeURIComponent(v)}` } });
    expect((await requireSession(mk(stale))).session.did).toBe(session!.did);
    await signOut(post('/api/auth/logout', {}, jar));
    await expect(requireSession(mk(stale))).rejects.toMatchObject({ status: 401 });

    // An unregistered origin is refused by Deluxe Main itself.
    process.env.APP_URL = 'http://localhost:4000';
    const rogue = await getAuthProvider().exchange(code).catch((e) => e);
    expect(rogue.status).toBe(400);
  });
});
