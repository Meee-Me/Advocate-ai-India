import { z } from 'zod';

/**
 * All configuration comes from environment variables and is read lazily, so
 * tests can change them and a missing variable only breaks the feature that
 * needs it (never the whole site).
 */

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

const env = (name: string): string => (process.env[name] ?? '').trim();
const stripSlash = (v: string) => v.replace(/\/+$/, '');
const path = (name: string, fallback: string) => {
  const v = env(name) || fallback;
  return v.startsWith('/') ? v : `/${v}`;
};

export const isProduction = () => process.env.NODE_ENV === 'production';

/** Public origin of this site, e.g. https://advocate-ai-india.vercel.app */
export function appUrl(): string {
  const explicit = env('APP_URL');
  if (explicit) return stripSlash(explicit);
  const vercel = env('VERCEL_PROJECT_PRODUCTION_URL');
  if (vercel) return `https://${vercel}`;
  if (isProduction()) throw new ConfigError('APP_URL is not set.');
  return 'http://localhost:3000';
}

export function sessionSecret(): string {
  const s = env('SESSION_SECRET');
  if (s.length < 32) {
    throw new ConfigError('SESSION_SECRET must be set to at least 32 characters (openssl rand -base64 48).');
  }
  return s;
}

export type AuthProviderName = 'deluxe' | 'dev';

export interface DeluxeConfig {
  baseUrl: string;
  appId: string;
  connectPath: string;
  exchangePath: string;
  mePath: string;
  logoutPath: string;
}

export function authProviderName(): AuthProviderName {
  const v = (env('AUTH_PROVIDER') || 'deluxe').toLowerCase();
  if (v !== 'deluxe' && v !== 'dev') throw new ConfigError(`AUTH_PROVIDER must be "deluxe" or "dev", not "${v}".`);
  if (v === 'dev' && (isProduction() || env('VERCEL_ENV') === 'production')) {
    throw new ConfigError('AUTH_PROVIDER=dev is for local development only and cannot run in production.');
  }
  return v;
}

/** Returns null when Deluxe Main sign-in has not been configured yet. */
export function deluxeConfig(): DeluxeConfig | null {
  const baseUrl = stripSlash(env('DELUXE_MAIN_URL'));
  if (!baseUrl) return null;
  try {
    new URL(baseUrl);
  } catch {
    throw new ConfigError('DELUXE_MAIN_URL is not a valid address.');
  }
  return {
    baseUrl,
    appId: env('DELUXE_APP_ID') || 'advocate',
    connectPath: path('DELUXE_CONNECT_PATH', '/connect'),
    exchangePath: path('DELUXE_EXCHANGE_PATH', '/api/connect/exchange'),
    mePath: path('DELUXE_ME_PATH', '/api/auth/me'),
    logoutPath: path('DELUXE_LOGOUT_PATH', '/api/auth/logout'),
  };
}

export type DatabaseDriver = 'postgres' | 'pglite';
export function databaseConfig(): { driver: DatabaseDriver; url: string; pgliteDir: string } {
  const driver = (env('DATABASE_DRIVER') || 'postgres') as DatabaseDriver;
  if (driver !== 'postgres' && driver !== 'pglite') throw new ConfigError('DATABASE_DRIVER must be "postgres" or "pglite".');
  if (driver === 'pglite' && isProduction() && env('ALLOW_PGLITE_IN_PRODUCTION') !== '1') {
    throw new ConfigError('The embedded database (pglite) is for local development only.');
  }
  return { driver, url: env('DATABASE_URL'), pgliteDir: env('PGLITE_DIR') || '.local-data/db' };
}

export type StorageDriver = 'supabase' | 'local';
export function storageConfig() {
  const driver = (env('STORAGE_DRIVER') || 'supabase') as StorageDriver;
  if (driver !== 'supabase' && driver !== 'local') throw new ConfigError('STORAGE_DRIVER must be "supabase" or "local".');
  if (driver === 'local' && isProduction()) throw new ConfigError('Local file storage is for development only.');
  return {
    driver,
    supabaseUrl: stripSlash(env('SUPABASE_URL')),
    serviceKey: env('SUPABASE_SERVICE_ROLE_KEY'),
    bucket: env('SUPABASE_STORAGE_BUCKET') || 'case-documents',
    localDir: env('LOCAL_STORAGE_DIR') || '.local-data/files',
  };
}

export function aiConfig() {
  const provider = (env('AI_PROVIDER') || 'anthropic') as 'anthropic' | 'mock';
  if (provider !== 'anthropic' && provider !== 'mock') throw new ConfigError('AI_PROVIDER must be "anthropic" or "mock".');
  if (provider === 'mock' && isProduction() && env('ALLOW_MOCK_AI_IN_PRODUCTION') !== '1') {
    throw new ConfigError('AI_PROVIDER=mock returns canned text and cannot run in production.');
  }
  const limit = z.coerce.number().int().min(1).max(100000).safeParse(env('AI_DAILY_LIMIT') || '300');
  return {
    provider,
    apiKey: env('ANTHROPIC_API_KEY'),
    model: env('ANTHROPIC_MODEL') || 'claude-opus-5-5',
    refusalFallback: env('ANTHROPIC_REFUSAL_FALLBACK') === 'default',
    dailyLimit: limit.success ? limit.data : 300,
  };
}

export function cronSecret(): string {
  return env('CRON_SECRET');
}
