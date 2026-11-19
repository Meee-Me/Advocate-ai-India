import { getDb } from '@/lib/db';
import { upsertFromDeluxe } from '@/lib/db/repos/advocates';
import { sealSession, sessionCookieName } from '@/lib/auth/session';
import { freshDb } from './helpers';

export const APP = 'http://localhost:3999';

export function testEnv() {
  Object.assign(process.env, {
    APP_URL: APP, SESSION_SECRET: 's'.repeat(48), AUTH_PROVIDER: 'deluxe', DELUXE_MAIN_URL: 'http://127.0.0.1:9',
    AI_PROVIDER: 'mock', CRON_SECRET: 'cron-secret-0123456789',
  });
}

export async function setup() {
  testEnv();
  const { db, client } = await freshDb();
  return { db, client };
}

export interface Who { id: string; cookie: string }

/** Creates an advocate and a ready-made session cookie for them. */
export async function signIn(name: string, deluxeId = `u_${name}`): Promise<Who> {
  const adv = await upsertFromDeluxe(await getDb(), { id: deluxeId, name });
  const sealed = await sealSession({ aid: adv.id, did: deluxeId, name, tok: 'tok', chk: Date.now() });
  return { id: adv.id, cookie: `${sessionCookieName()}=${encodeURIComponent(sealed)}` };
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
