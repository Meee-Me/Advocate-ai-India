/**
 * Safe diagnostics for database failures.
 *
 * What may be logged: the error's type, a short error code (PostgreSQL "28P01", Node "ENOTFOUND", ...) and a
 * sanitized message. What may never be logged: connection strings, passwords, tokens, cookies, the person's
 * name or ids, SQL parameters, or row data.
 *
 * Why the message is taken from the innermost error: Drizzle wraps a driver failure in an error whose message is
 * "Failed query: <SQL> params: <values>", and the values are the signed-in person's details. The driver's own
 * error (the `cause`) holds the real reason and none of that.
 */
export interface DbFailure {
  /** Error class name of the underlying driver error, e.g. "PostgresError" or "Error". */
  type: string;
  /** Short identifier such as "28P01", "ECONNREFUSED" or "CONNECT_TIMEOUT". Only returned if it looks like one. */
  code?: string;
  /** Sanitized, length-limited message. */
  message: string;
}

const SAFE_CODE = /^[A-Za-z0-9_]{3,40}$/;
const MAX_MESSAGE = 200;

/** Removes anything that could carry a credential or personal detail from an error message. */
export function sanitizeMessage(raw: string, secrets: readonly string[] = []): string {
  let m = String(raw ?? '');
  // Never keep anything from a "params:" list onwards (SQL parameters).
  m = m.replace(/\bparams?\s*:[\s\S]*$/i, '');
  // Exact values we know are sensitive (the person's name/id, tokens, codes). Very short ones would mangle the text.
  for (const s of secrets) if (s && s.length >= 4) m = m.split(s).join('[redacted]');
  m = m
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, '[url]') // postgres://user:password@host/db, https://...
    .replace(/[^\s:@/"']+:[^\s@/"']+@/g, '[credentials]@') // user:password@ without a scheme
    .replace(/\b(password|passwd|pwd|secret|token|apikey|api_key|authorization|cookie)\b\s*[=:]\s*\S+/gi, '$1=[redacted]')
    .replace(/\bBearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/[A-Za-z0-9_\-+/=]{32,}/g, '[token]'); // anything long and random-looking
  m = m.replace(/\s+/g, ' ').trim();
  return m.length > MAX_MESSAGE ? `${m.slice(0, MAX_MESSAGE)}…` : m;
}

/** Follows `cause` (and the first of an AggregateError's `errors`) down to the driver's own error. */
function chainOf(error: unknown): Record<string, unknown>[] {
  const chain: Record<string, unknown>[] = [];
  let e: unknown = error;
  for (let i = 0; i < 6 && e && typeof e === 'object'; i++) {
    const obj = e as Record<string, unknown>;
    chain.push(obj);
    const errors = obj.errors;
    e = obj.cause ?? (Array.isArray(errors) ? errors[0] : undefined);
  }
  return chain;
}

export function describeDbError(error: unknown, secrets: readonly string[] = []): DbFailure {
  const chain = chainOf(error);
  if (!chain.length) return { type: typeof error, message: 'Not an Error object.' };
  const inner = chain[chain.length - 1];
  const type = String((inner.name as string) || (inner.constructor as { name?: string } | undefined)?.name || 'Error').slice(0, 60);
  // The most specific code wins: the driver's, then anything wrapping it.
  let code: string | undefined;
  for (let i = chain.length - 1; i >= 0 && !code; i--) {
    const c = chain[i].code;
    if (typeof c === 'string' && SAFE_CODE.test(c)) code = c;
  }
  const raw = typeof inner.message === 'string' ? inner.message : '';
  const message = /^\s*failed query/i.test(raw) ? '[query text withheld]' : sanitizeMessage(raw, secrets);
  return { type, ...(code ? { code } : {}), message: message || [type, code].filter(Boolean).join(' ') };
}

/** Logs a database failure safely (one JSON line) and returns what was logged. */
export function logDbFailure(context: string, error: unknown, secrets: readonly string[] = []): DbFailure {
  const info = describeDbError(error, secrets);
  console.error(`${context}:`, JSON.stringify(info));
  return info;
}
