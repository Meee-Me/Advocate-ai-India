import { z } from 'zod';
import { appUrl, authProviderName, ConfigError, deluxeConfig } from '@/lib/config';

export interface DeluxeUser {
  id: string;
  name: string;
  handle?: string;
}

export interface ExchangeResult {
  token: string;
  user: DeluxeUser;
}

/**
 * The sign-in integration. Everything that talks to Deluxe Main lives behind
 * this interface, so if Deluxe Main's API changes only this file changes.
 */
export interface AuthProvider {
  /** Where to send the browser to sign in. `returnUrl` receives `#deluxe_code=...`. */
  startUrl(returnUrl: string): string;
  /** Trades the one-use code for this website's key. */
  exchange(code: string): Promise<ExchangeResult>;
  /** The user if the key is still valid, null if Deluxe Main ended it. Throws if Deluxe Main cannot be reached. */
  validate(token: string): Promise<DeluxeUser | null>;
  /** Ends this website's key (best effort). */
  logout(token: string): Promise<void>;
}

export class AuthError extends Error {
  constructor(message: string, public status = 401) {
    super(message);
    this.name = 'AuthError';
  }
}

const userSchema = z.object({ id: z.string().min(1).max(200), name: z.string().min(1).max(200), handle: z.string().max(200).optional().nullable() });
const exchangeSchema = z.object({ token: z.string().min(16), user: userSchema, app: z.string().optional() });
const meSchema = z.object({ user: userSchema });

const TIMEOUT_MS = 8000;

class DeluxeProvider implements AuthProvider {
  constructor(private cfg: NonNullable<ReturnType<typeof deluxeConfig>>) {}

  startUrl(returnUrl: string): string {
    const url = new URL(this.cfg.connectPath, this.cfg.baseUrl);
    url.searchParams.set('return', returnUrl);
    url.searchParams.set('app', this.cfg.appId);
    return url.toString();
  }

  async exchange(code: string): Promise<ExchangeResult> {
    if (!/^[0-9a-f]{48}$/.test(code)) throw new AuthError('That sign-in code is not valid.', 400);
    let res: Response;
    try {
      res = await fetch(new URL(this.cfg.exchangePath, this.cfg.baseUrl), {
        method: 'POST',
        // Deluxe Main binds each code to the website's origin, so it must be sent.
        headers: { 'Content-Type': 'application/json', Origin: new URL(appUrl()).origin },
        body: JSON.stringify({ code }),
        cache: 'no-store',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new AuthError('Deluxe Main could not be reached. Try again in a moment.', 503);
    }
    if (!res.ok) throw new AuthError('That sign-in has expired. Please sign in again.', res.status === 429 ? 429 : 400);
    const parsed = exchangeSchema.safeParse(await res.json().catch(() => null));
    if (!parsed.success) throw new AuthError('Deluxe Main answered in an unexpected way.', 502);
    if (parsed.data.app && parsed.data.app !== this.cfg.appId) {
      throw new AuthError(`Deluxe Main signed this site in as "${parsed.data.app}", but it is configured as "${this.cfg.appId}".`, 502);
    }
    const { id, name, handle } = parsed.data.user;
    return { token: parsed.data.token, user: { id, name, handle: handle ?? undefined } };
  }

  async validate(token: string): Promise<DeluxeUser | null> {
    const res = await fetch(new URL(this.cfg.mePath, this.cfg.baseUrl), {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 401 || res.status === 403) return null;
    if (!res.ok) throw new AuthError('Deluxe Main is not answering.', 503);
    const parsed = meSchema.safeParse(await res.json().catch(() => null));
    if (!parsed.success) throw new AuthError('Deluxe Main answered in an unexpected way.', 502);
    const { id, name, handle } = parsed.data.user;
    return { id, name, handle: handle ?? undefined };
  }

  async logout(token: string): Promise<void> {
    await fetch(new URL(this.cfg.logoutPath, this.cfg.baseUrl), {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    }).catch(() => undefined);
  }
}

/** Local-development stand-in. authProviderName() refuses it in production. */
class DevProvider implements AuthProvider {
  startUrl(returnUrl: string) {
    return `${returnUrl}#deluxe_code=${'0'.repeat(48)}`;
  }
  async exchange(code: string): Promise<ExchangeResult> {
    if (code !== '0'.repeat(48)) throw new AuthError('Invalid development code.', 400);
    return { token: 'dev-token-0000000000000000', user: { id: 'dev-advocate', name: 'Dev Advocate', handle: 'dev' } };
  }
  async validate() {
    return { id: 'dev-advocate', name: 'Dev Advocate', handle: 'dev' };
  }
  async logout() {}
}

export function getAuthProvider(): AuthProvider {
  if (authProviderName() === 'dev') return new DevProvider();
  const cfg = deluxeConfig();
  if (!cfg) throw new ConfigError('Sign-in with Deluxe Main is not configured yet (DELUXE_MAIN_URL).');
  return new DeluxeProvider(cfg);
}

export function isAuthConfigured(): boolean {
  try {
    return authProviderName() === 'dev' || deluxeConfig() !== null;
  } catch {
    return false;
  }
}
