import { ZodError, type ZodType } from 'zod';
import { ConfigError } from '@/lib/config';
import { getDb, type Db } from '@/lib/db';
import { AuthError } from '@/lib/auth/provider';
import { requireSession, assertSameOrigin, type AuthedSession } from '@/lib/auth/guard';
import { AiError } from '@/lib/ai/errors';
import { HttpError } from '@/lib/http-errors';

export { HttpError };
export const notFound = (what = 'Not found') => new HttpError(404, what, 'not_found');
export const badRequest = (msg: string) => new HttpError(400, msg, 'bad_request');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Ids from the URL: anything that is not a UUID simply does not exist. */
export function uuid(value: string | undefined | null): string {
  if (!value || !UUID.test(value)) throw notFound();
  return value.toLowerCase();
}

export function json(data: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers } });
}

const MAX_BODY = 3_000_000; // ~3 MB of JSON (pasted judgments can be long)

export async function readBody<T>(req: Request, schema: ZodType<T>, maxBytes = MAX_BODY): Promise<T> {
  const declared = Number(req.headers.get('content-length') ?? 0);
  if (declared > maxBytes) throw new HttpError(413, 'That request is too large.', 'too_large');
  const text = await req.text();
  if (text.length > maxBytes) throw new HttpError(413, 'That request is too large.', 'too_large');
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw badRequest('The request body is not valid JSON.');
  }
  return schema.parse(data);
}

export function readQuery<T>(req: Request, schema: ZodType<T>): T {
  const url = new URL(req.url);
  return schema.parse(Object.fromEntries(url.searchParams));
}

export interface ApiCtx<P> {
  req: Request;
  params: P;
  db: Db;
  advocateId: string;
  advocateName: string;
}

interface Opts { csrf?: boolean }

type RouteCtx<P> = { params: Promise<P> };

/** Wraps an authenticated API route: session check, CSRF check, error mapping. */
export function api<P extends Record<string, string> = Record<string, never>>(
  fn: (ctx: ApiCtx<P>) => Promise<unknown>,
  opts: Opts = {},
) {
  return async (req: Request, route?: RouteCtx<P>): Promise<Response> => {
    const extra: string[] = [];
    try {
      if (opts.csrf !== false) assertSameOrigin(req);
      const auth: AuthedSession = await requireSession(req);
      if (auth.setCookie) extra.push(auth.setCookie);
      const params = (route ? await route.params : {}) as P;
      const db = await getDb();
      const out = await fn({ req, params, db, advocateId: auth.session.aid, advocateName: auth.session.name });
      const res = out instanceof Response ? out : json(out ?? { ok: true });
      for (const c of extra) res.headers.append('Set-Cookie', c);
      return res;
    } catch (error) {
      return errorResponse(error, extra);
    }
  };
}

/** For routes that do their own auth (sign-in, cron, health). */
export function open(fn: (req: Request) => Promise<Response | unknown>) {
  return async (req: Request): Promise<Response> => {
    try {
      const out = await fn(req);
      return out instanceof Response ? out : json(out ?? { ok: true });
    } catch (error) {
      return errorResponse(error, []);
    }
  };
}

export function errorResponse(error: unknown, cookies: string[]): Response {
  const res = toResponse(error);
  for (const c of cookies) res.headers.append('Set-Cookie', c);
  return res;
}

function toResponse(error: unknown): Response {
  if (error instanceof HttpError) return json({ error: error.message, code: error.code }, error.status);
  if (error instanceof AuthError) return json({ error: error.message, code: 'auth' }, error.status);
  if (error instanceof AiError) return json({ error: error.message, code: error.code }, error.status);
  if (error instanceof ZodError) {
    const issue = error.issues[0];
    const where = issue?.path?.length ? `${issue.path.join('.')}: ` : '';
    return json({ error: `${where}${issue?.message ?? 'Invalid input.'}`, code: 'invalid' }, 400);
  }
  if (error instanceof ConfigError) {
    console.error('Configuration problem:', error.message);
    return json({ error: error.message, code: 'not_configured' }, 503);
  }
  const pg = error as { code?: string; cause?: { code?: string } };
  const pgCode = pg?.code ?? pg?.cause?.code;
  if (pgCode === '23505') return json({ error: 'That already exists.', code: 'conflict' }, 409);
  if (pgCode === '23503') return json({ error: 'That refers to something that does not exist.', code: 'invalid' }, 400);
  if (pgCode === '22P02') return json({ error: 'Not found', code: 'not_found' }, 404);
  // Never echo internals (or anything resembling client data) to the browser.
  console.error('Unhandled API error:', error instanceof Error ? `${error.name}: ${error.message}` : 'unknown');
  return json({ error: 'Something went wrong. Please try again.', code: 'internal' }, 500);
}
