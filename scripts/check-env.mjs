// Pre-deploy check: node --env-file=.env.local scripts/check-env.mjs   (or run with the variables exported)
// Prints which variables are missing or unsafe for production. It never prints a value.
const env = process.env;
const problems = [];
const need = (name, test = (v) => v.length > 0, why = 'is not set') => { const v = (env[name] ?? '').trim(); if (!v || !test(v)) problems.push(`${name} ${why}`); };

need('APP_URL', (v) => /^https:\/\/[^/]+$/.test(v), 'must be the exact https address with no trailing slash (e.g. https://your-site.vercel.app)');
need('SESSION_SECRET', (v) => v.length >= 32, 'must be 32+ characters (openssl rand -base64 48)');
need('DELUXE_MAIN_URL', (v) => /^https?:\/\//.test(v), 'must be the address of Deluxe Main');
need('DATABASE_URL', (v) => /^postgres(ql)?:\/\//.test(v), 'must be a Postgres connection string (Supabase transaction pooler, port 6543)');
need('SUPABASE_URL', (v) => /^https:\/\//.test(v));
need('SUPABASE_SERVICE_ROLE_KEY');
need('SAMBANOVA_API_KEY');
need('CRON_SECRET', (v) => v.length >= 16, 'must be 16+ characters');
if ((env.AI_PROVIDER ?? 'sambanova').trim() === 'anthropic') need('ANTHROPIC_API_KEY', (v) => v.length > 0, 'is required when AI_PROVIDER=anthropic');
for (const [name, bad] of [['AUTH_PROVIDER', 'dev'], ['AI_PROVIDER', 'mock'], ['DATABASE_DRIVER', 'pglite'], ['STORAGE_DRIVER', 'local']]) {
  if ((env[name] ?? '').trim() === bad) problems.push(`${name}=${bad} is for local development only`);
}
for (const name of Object.keys(env)) {
  if (/^NEXT_PUBLIC_.*(SECRET|SERVICE|ANTHROPIC|KEY)/i.test(name)) problems.push(`${name} would be sent to every browser: remove the NEXT_PUBLIC_ prefix`);
}
if (problems.length) {
  console.error('Not ready to deploy:\n' + problems.map((p) => `  ✗ ${p}`).join('\n'));
  process.exit(1);
}
console.log('Environment looks ready for production (values not shown).');
