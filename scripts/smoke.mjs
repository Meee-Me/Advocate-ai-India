// Black-box smoke test of a running site:  node scripts/smoke.mjs https://your-site.vercel.app
// Checks reachability, the sign-in gate, security headers and Deluxe Main wiring. No secrets needed.
const base = (process.argv[2] ?? 'http://localhost:3000').replace(/\/+$/, '');
let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) failed++; };
const get = (p, init = {}) => fetch(base + p, { redirect: 'manual', ...init });

const home = await get('/');
check(home.status === 200, `/ is reachable (${home.status})`);
const h = home.headers;
check(!!h.get('content-security-policy'), 'Content-Security-Policy header is set');
check(h.get('x-frame-options') === 'DENY', 'X-Frame-Options: DENY');
check(h.get('x-content-type-options') === 'nosniff', 'X-Content-Type-Options: nosniff');
check(!h.get('x-powered-by'), 'X-Powered-By is hidden');

const login = await get('/login');
check(login.status === 200, `/login is reachable (${login.status})`);
const page = await get('/dashboard');
check([302, 303, 307, 308].includes(page.status) && (page.headers.get('location') ?? '').includes('/login'), 'signed-out /dashboard redirects to /login');
for (const p of ['/api/cases', '/api/clients', '/api/dashboard', '/api/profile', '/api/notifications']) {
  const r = await get(p);
  check(r.status === 401, `${p} requires sign-in (${r.status})`);
}
const post = await get('/api/cases', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://evil.example' }, body: '{"title":"x"}' });
check([401, 403].includes(post.status), `cross-site write is refused (${post.status})`);
const cron = await get('/api/cron/reminders');
check([401, 503].includes(cron.status), `reminder job refuses anonymous callers (${cron.status})`);

const health = await get('/api/health').then((r) => r.json()).catch(() => null);
check(!!health?.ok, '/api/health answers');
if (health) {
  check(health.auth === true, 'Deluxe Main sign-in is configured');
  check(health.database === true, 'database is configured');
  check(health.ai === true, 'Anthropic API key is configured');
}
const start = await get('/api/auth/start?next=/cases');
const loc = start.headers.get('location') ?? '';
check(start.status === 302 && /\/connect\?/.test(loc) && loc.includes('app=advocate') && /return=/.test(loc), 'sign-in redirects to Deluxe Main /connect with app + return');
check((start.headers.get('set-cookie') ?? '').includes('HttpOnly'), 'sign-in sets an httpOnly state cookie');

console.log(failed ? `\n${failed} check(s) failed` : '\nSmoke test passed');
process.exit(failed ? 1 : 0);
