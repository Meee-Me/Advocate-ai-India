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

export type AiProviderName = 'sambanova' | 'anthropic' | 'mock';

const num = (name: string, fallback: number, min = 0, max = 1e9) => {
  const raw = env(name);
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
};

/**
 * Which AI vendor answers. Change AI_PROVIDER (and that vendor's variables) to switch;
 * there is no automatic fallback between vendors.
 */
export function aiConfig() {
  const provider = (env('AI_PROVIDER') || 'sambanova').toLowerCase() as AiProviderName;
  if (!['sambanova', 'anthropic', 'mock'].includes(provider)) {
    throw new ConfigError('AI_PROVIDER must be "sambanova", "anthropic" or "mock".');
  }
  if (provider === 'mock' && isProduction() && env('ALLOW_MOCK_AI_IN_PRODUCTION') !== '1') {
    throw new ConfigError('AI_PROVIDER=mock returns canned text and cannot run in production.');
  }
  const effort = env('SAMBANOVA_REASONING_EFFORT').toLowerCase();
  // Free-tier defaults for SambaNova (per API key and model): 20 requests/minute, 20/day, 200,000 tokens/day.
  // They are enforced here, across everyone using the site, so the site says "limit reached" instead of failing.
  // Raise them (or set 0 to switch a limit off) after moving to a paid plan.
  const free = provider === 'sambanova';
  return {
    provider,
    dailyLimit: num('AI_DAILY_LIMIT', 300, 1, 100000), // per advocate
    maxInputChars: num('AI_MAX_INPUT_CHARS', free ? 150000 : 700000, 1000),
    limits: {
      rpm: num('AI_LIMIT_RPM', free ? 20 : 0),
      rpd: num('AI_LIMIT_RPD', free ? 20 : 0),
      tpd: num('AI_LIMIT_TPD', free ? 200000 : 0),
    },
    sambanova: {
      apiKey: env('SAMBANOVA_API_KEY'),
      baseUrl: stripSlash(env('SAMBANOVA_BASE_URL') || 'https://api.sambanova.ai/v1'),
      model: env('SAMBANOVA_MODEL') || 'gpt-oss-120b',
      maxOutputTokens: num('SAMBANOVA_MAX_OUTPUT_TOKENS', 12000, 256, 128000),
      reasoningEffort: (['low', 'medium', 'high'].includes(effort) ? effort : '') as '' | 'low' | 'medium' | 'high',
      timeoutMs: num('SAMBANOVA_TIMEOUT_MS', 270_000, 5000, 600_000),
    },
    anthropic: {
      apiKey: env('ANTHROPIC_API_KEY'),
      model: env('ANTHROPIC_MODEL') || 'claude-opus-5-5',
      refusalFallback: env('ANTHROPIC_REFUSAL_FALLBACK') === 'default',
    },
  };
}

/** The model name of the active provider (for display and records). */
export const activeModel = () => {
  const c = aiConfig();
  return c.provider === 'sambanova' ? c.sambanova.model : c.provider === 'anthropic' ? c.anthropic.model : 'mock';
};

/** OCR language codes, e.g. "eng+hin". Each needs its @tesseract.js-data/<code> package (see src/lib/pdf/ocr.ts). */
export function ocrLanguages(): string[] {
  const langs = (env('OCR_LANGUAGES') || 'eng+hin').toLowerCase().split(/[+,\s]+/).filter(Boolean);
  return langs.length ? langs : ['eng'];
}
export const ocrMaxPages = () => num('OCR_MAX_PAGES', 60, 1, 500);

/** "redact" (default, strict): unverified reporter citations are removed. "tag": they are only marked. */
export const citationMode = (): 'redact' | 'tag' => (env('CITATION_MODE').toLowerCase() === 'tag' ? 'tag' : 'redact');

export function cronSecret(): string {
  return env('CRON_SECRET');
}
