// Black-box smoke test of a running site:  node scripts/smoke.mjs https://your-site.vercel.app
// Checks reachability, the sign-in gate, the sign-up acknowledgement, security headers and the Supabase sign-in wiring.
// No secrets needed, and nothing here creates an account, sends an email or calls Supabase with credentials.
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
const register = await get('/register');
const registerHtml = await register.text();
check(register.status === 200, `/register is reachable (${register.status})`);
check(registerHtml.includes('Keep your sign-in details safe') && registerHtml.includes('without extra encryption'), 'sign-up shows the sign-in warning and the storage notice');
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
  check(health.auth === true, 'Supabase sign-in is configured (SUPABASE_URL and the public SUPABASE_ANON_KEY)');
  check(health.database === true, 'database is configured');
  check(['sambanova', 'ollama', 'anthropic'].includes(health.ai?.provider), `AI provider is a real one (got ${health.ai?.provider})`);
  check(health.ai?.configured === true, 'AI provider key is set (a real call still needs the Test AI connection button)');
  check(health.ai?.provider !== 'mock', 'AI is not the mock');
}
// Sign-in routes. Each of these is refused before any Supabase call is made.
const json = { 'content-type': 'application/json', origin: base };
const me = await get('/api/auth/me');
check(me.status === 401, `/api/auth/me requires sign-in (${me.status})`);
const crossSite = await get('/api/auth/login', { method: 'POST', headers: { ...json, origin: 'https://evil.example' }, body: '{"email":"a@example.com","password":"x"}' });
check(crossSite.status === 403, `a cross-site sign-in attempt is refused (${crossSite.status})`);
const emptyLogin = await get('/api/auth/login', { method: 'POST', headers: json, body: '{}' });
check(emptyLogin.status === 400, `sign-in with no details is rejected (${emptyLogin.status})`);
const noAck = await get('/api/auth/register', { method: 'POST', headers: json, body: JSON.stringify({ fullName: 'Smoke Test', email: 'smoke-test@example.invalid', password: 'smoke-test-pass-1', confirmPassword: 'smoke-test-pass-1', acknowledged: false }) });
check(noAck.status === 400, `sign-up without the acknowledgement is refused by the server (${noAck.status})`);
const oldRoute = await get('/api/auth/start?next=/cases');
check(oldRoute.status === 401 || oldRoute.status === 404, `the retired /api/auth/start route is gone (${oldRoute.status})`);

console.log(failed ? `\n${failed} check(s) failed` : '\nSmoke test passed');
process.exit(failed ? 1 : 0);
