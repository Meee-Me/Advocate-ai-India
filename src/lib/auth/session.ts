import { EncryptJWT, jwtDecrypt } from 'jose';
import { appUrl, sessionSecret } from '@/lib/config';

/**
 * The browser session: an encrypted (JWE, A256GCM) httpOnly cookie. It holds the
 * advocate's ids and the Deluxe Main key, which therefore never reaches page
 * JavaScript. Revalidating against Deluxe Main happens in the API guard.
 */
export interface SessionData {
  aid: string; // advocate id (our database)
  did: string; // Deluxe account id
  name: string;
  tok: string; // key issued to this website by Deluxe Main
  chk: number; // when Deluxe Main last confirmed the key (ms)
}

export const SESSION_MAX_AGE_S = 14 * 24 * 60 * 60;
export const REVALIDATE_AFTER_MS = 15 * 60 * 1000;

const secure = () => appUrl().startsWith('https://');
export const sessionCookieName = () => (secure() ? '__Host-advocate_session' : 'advocate_session');
export const stateCookieName = () => (secure() ? '__Host-advocate_state' : 'advocate_state');

async function key(): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`advocate-session:${sessionSecret()}`));
  return new Uint8Array(digest);
}

export async function sealSession(data: SessionData): Promise<string> {
  return new EncryptJWT({ ...data })
    .setProtectedHeader({ alg: 'dir', enc: 'A256GCM' })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE_S}s`)
    .encrypt(await key());
}

export async function openSession(value: string | undefined | null): Promise<SessionData | null> {
  if (!value) return null;
  try {
    const { payload } = await jwtDecrypt(value, await key(), { contentEncryptionAlgorithms: ['A256GCM'], keyManagementAlgorithms: ['dir'] });
    const { aid, did, name, tok, chk } = payload as Record<string, unknown>;
    if (typeof aid !== 'string' || typeof did !== 'string' || typeof name !== 'string' || typeof tok !== 'string' || typeof chk !== 'number') return null;
    return { aid, did, name, tok, chk };
  } catch {
    return null; // tampered, expired, or sealed with another secret
  }
}

export function cookieOptions(maxAge: number) {
  return { httpOnly: true, secure: secure(), sameSite: 'lax' as const, path: '/', maxAge };
}
