import { getDb } from '@/lib/db';
import { ensureAdvocate } from '@/lib/db/repos/advocates';
import { authCookieName } from '@/lib/auth/supabase';
import { fakeUsers } from './fake-supabase';
import { freshDb } from './helpers';

export const APP = 'http://localhost:3999';

export function testEnv() {
  Object.assign(process.env, {
    APP_URL: APP, SUPABASE_URL: 'https://test.supabase.co', SUPABASE_ANON_KEY: 'anon-test-key',
    AI_PROVIDER: 'mock', CRON_SECRET: 'cron-secret-0123456789',
  });
}

export async function setup() {
  testEnv();
  const { db, client } = await freshDb();
  return { db, client };
}

export interface Who { id: string; cookie: string }

/** Creates a confirmed account and advocate row, and returns a ready-made signed-in cookie. */
export async function signIn(name: string): Promise<Who> {
  const id = crypto.randomUUID();
  const email = `${name.toLowerCase().replace(/\W/g, '')}@users.advocate-ai.invalid`;
  fakeUsers.set(email, { id, email, password: 'correct-horse-9', name, confirmed: true });
  await ensureAdvocate(await getDb(), { id, name, email });
  return { id, cookie: `${authCookieName()}=${id}` };
}

type Handler = (req: Request, ctx?: { params: Promise<never> }) => Promise<Response>;

export async function call(
  handler: Handler,
  method: string,
  path: string,
  o: { who?: Who; body?: unknown; params?: Record<string, string>; headers?: Record<string, string>; raw?: boolean } = {},
) {
  const headers: Record<string, string> = { host: 'localhost:3999', ...(o.headers ?? {}) };
  if (method !== 'GET' && !('origin' in headers)) headers.origin = APP;
  if (o.who) headers.cookie = o.who.cookie;
  if (o.body !== undefined) headers['content-type'] = 'application/json';
  const req = new Request(APP + path, { method, headers, body: o.body === undefined ? undefined : JSON.stringify(o.body) });
  const res = await handler(req, { params: Promise.resolve(o.params ?? {}) as Promise<never> });
  if (o.raw) return { status: res.status, res, data: null as never };
  const ct = res.headers.get('content-type') ?? '';
  const data = ct.includes('json') ? await res.json() : await res.text();
  return { status: res.status, data: data as any, res }; // eslint-disable-line @typescript-eslint/no-explicit-any
}
