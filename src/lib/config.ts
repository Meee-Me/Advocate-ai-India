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

export interface SupabaseAuthConfig {
  /** The Supabase project address, e.g. https://<project-ref>.supabase.co */
  url: string;
  /** The PUBLIC anon / publishable key. Never the service-role (secret) key. */
  anonKey: string;
}

/** Reads a JWT's payload without verifying it (only used to refuse a service-role key). */
function jwtRole(token: string): string | null {
  const part = token.split('.')[1];
  if (!part) return null;
  try {
    const payload = JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as { role?: unknown };
    return typeof payload.role === 'string' ? payload.role : null;
  } catch {
    return null;
  }
}

/**
 * Supabase Auth settings. Both values are read on the server only (never sent to the browser).
 * Accepted names, in order: SUPABASE_URL / NEXT_PUBLIC_SUPABASE_URL and SUPABASE_ANON_KEY / SUPABASE_PUBLISHABLE_KEY /
 * NEXT_PUBLIC_SUPABASE_ANON_KEY / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (so the Vercel-Supabase integration's names work).
 * A service-role key is refused here, so a mistake cannot hand it to the auth client.
 */
export function supabaseAuthConfig(): SupabaseAuthConfig {
  const url = stripSlash(env('SUPABASE_URL') || env('NEXT_PUBLIC_SUPABASE_URL'));
  const anonKey = env('SUPABASE_ANON_KEY') || env('SUPABASE_PUBLISHABLE_KEY') || env('NEXT_PUBLIC_SUPABASE_ANON_KEY') || env('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY');
  if (!url || !anonKey) {
    throw new ConfigError('Sign-in is not configured yet: set SUPABASE_URL and SUPABASE_ANON_KEY (the public anon key).');
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ConfigError('SUPABASE_URL is not a valid address.');
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
  if (parsed.protocol !== 'https:' && !(local && parsed.protocol === 'http:')) {
    throw new ConfigError('SUPABASE_URL must be an https address.');
  }
  if (anonKey.startsWith('sb_secret_') || jwtRole(anonKey) === 'service_role') {
    throw new ConfigError('SUPABASE_ANON_KEY must be the public anon/publishable key, never the service-role (secret) key.');
  }
  return { url, anonKey };
}

/** True when Supabase Auth is configured (presence and shape only; never reveals a value). */
export function isAuthConfigured(): boolean {
  try {
    supabaseAuthConfig();
    return true;
  } catch {
    return false;
  }
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

export type AiProviderName = 'sambanova' | 'ollama' | 'anthropic' | 'mock';

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
  if (!['sambanova', 'ollama', 'anthropic', 'mock'].includes(provider)) {
    throw new ConfigError('AI_PROVIDER must be "sambanova", "ollama", "anthropic" or "mock".');
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
    // Default input ceilings keep one request inside the model's context window:
    // SambaNova free tier ~40k tokens; Ollama gpt-oss:120b has a 131k-token context (~85k tokens here, leaving room for the answer).
    maxInputChars: num('AI_MAX_INPUT_CHARS', free ? 150000 : provider === 'ollama' ? 300000 : 700000, 1000),
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
    // Ollama Cloud, through its OpenAI-compatible endpoint. Its usage limits belong to the account and are enforced
    // by Ollama (the site shows its "limit reached" answer), so no request pacing is counted here by default.
    ollama: {
      apiKey: env('OLLAMA_API_KEY'),
      baseUrl: stripSlash(env('OLLAMA_BASE_URL') || 'https://ollama.com/v1'),
      model: env('OLLAMA_MODEL') || 'gpt-oss:120b',
      maxOutputTokens: num('OLLAMA_MAX_OUTPUT_TOKENS', 12000, 256, 128000),
      timeoutMs: num('OLLAMA_TIMEOUT_MS', 270_000, 5000, 600_000),
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
  return c.provider === 'sambanova' ? c.sambanova.model
    : c.provider === 'ollama' ? c.ollama.model
    : c.provider === 'anthropic' ? c.anthropic.model
    : 'mock';
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
