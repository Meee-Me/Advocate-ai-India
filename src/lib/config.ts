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

const REAL_AI = ['sambanova', 'ollama', 'openrouter', 'unorouter', 'groq', 'gemini', 'sarvam', 'anthropic'];
export type AiProviderName = 'sambanova' | 'ollama' | 'openrouter' | 'unorouter' | 'groq' | 'gemini' | 'sarvam' | 'anthropic' | 'mock';

const num = (name: string, fallback: number, min = 0, max = 1e9) => {
  const raw = env(name);
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
};

/**
 * Which AI vendor answers. Change AI_PROVIDER (and that vendor's variables) to switch;
 * there is no automatic fallback between vendors, except the one optional backup named in AI_BACKUP_PROVIDER (Groq),
 * which is tried only when the main vendor cannot answer at all (key rejected, plan needed, limit reached, down).
 */
export function aiConfig() {
  const provider = (env('AI_PROVIDER') || 'sambanova').toLowerCase() as AiProviderName;
  if (!REAL_AI.concat(['mock']).includes(provider)) {
    throw new ConfigError(`AI_PROVIDER must be one of: ${REAL_AI.join(', ')} or mock.`);
  }
  // Optional per-request routing: AI_TASK_PROVIDER answers drafting, editing and translation; AI_MALAYALAM_PROVIDER answers Malayalam text.
  const routeOf = (name: string): AiProviderName | null => {
    const v = env(name).toLowerCase();
    if (!v) return null;
    if (!REAL_AI.includes(v)) throw new ConfigError(`${name} must be empty or one of: ${REAL_AI.join(', ')}.`);
    return v as AiProviderName;
  };
  const routes = { task: routeOf('AI_TASK_PROVIDER'), malayalam: routeOf('AI_MALAYALAM_PROVIDER') };
  const backupRaw = env('AI_BACKUP_PROVIDER').toLowerCase();
  if (backupRaw && backupRaw !== 'groq') throw new ConfigError('AI_BACKUP_PROVIDER must be empty or "groq".');
  const backup = backupRaw === 'groq' && provider !== 'groq' && provider !== 'mock' ? ('groq' as const) : null;
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
    routes,
    backup,
    dailyLimit: num('AI_DAILY_LIMIT', 300, 1, 100000), // per advocate
    // Default input ceilings keep one request inside the model's context window:
    // SambaNova free tier ~40k tokens; Ollama gpt-oss:120b has a 131k-token context (~85k tokens here, leaving room for the answer).
    maxInputChars: num('AI_MAX_INPUT_CHARS', free ? 150000 : ['ollama', 'openrouter', 'unorouter', 'groq'].includes(provider) ? 300000 : 700000, 1000),
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
    // OpenRouter, OpenAI-compatible. The default is a free model; free models have request limits and may log prompts,
    // so use made-up data only. Use a model name from openrouter.ai/models, e.g. one ending in ":free".
    openrouter: {
      name: 'openrouter',
      keyVar: 'OPENROUTER_API_KEY',
      apiKey: env('OPENROUTER_API_KEY'),
      baseUrl: stripSlash(env('OPENROUTER_BASE_URL') || 'https://openrouter.ai/api/v1'),
      model: env('OPENROUTER_MODEL') || 'openai/gpt-oss-120b:free',
      maxOutputTokens: num('OPENROUTER_MAX_OUTPUT_TOKENS', 8000, 256, 128000),
      timeoutMs: num('OPENROUTER_TIMEOUT_MS', 180_000, 5000, 600_000),
    },
    // UnoRouter, a third-party OpenAI-compatible gateway (api.unorouter.com). The model has no default: set UNOROUTER_MODEL to a
    // model code from its Models page. A gateway sits between this site and the model's maker, so what it logs or keeps is up to it.
    unorouter: {
      name: 'unorouter',
      keyVar: 'UNOROUTER_API_KEY',
      apiKey: env('UNOROUTER_API_KEY'),
      baseUrl: stripSlash(env('UNOROUTER_BASE_URL') || 'https://api.unorouter.com/v1'),
      model: env('UNOROUTER_MODEL'),
      maxOutputTokens: num('UNOROUTER_MAX_OUTPUT_TOKENS', 12000, 256, 128000),
      timeoutMs: num('UNOROUTER_TIMEOUT_MS', 90_000, 5000, 600_000),
    },
    // Google Gemini through its OpenAI-compatible endpoint. The free tier may use prompts to improve Google's products: made-up data only.
    gemini: {
      name: 'gemini',
      keyVar: 'GEMINI_API_KEY',
      apiKey: env('GEMINI_API_KEY'),
      baseUrl: stripSlash(env('GEMINI_BASE_URL') || 'https://generativelanguage.googleapis.com/v1beta/openai'),
      model: env('GEMINI_MODEL') || 'gemini-4-hydrogen',
      // Gemini thinks at length by default; "low" keeps answers quick. Use GEMINI_REASONING_EFFORT to change it.
      reasoningEffort: env('GEMINI_REASONING_EFFORT') || 'low',
      maxOutputTokens: num('GEMINI_MAX_OUTPUT_TOKENS', 12000, 256, 128000),
      timeoutMs: num('GEMINI_TIMEOUT_MS', 180_000, 5000, 600_000),
    },
    // Sarvam AI (Indian languages). Address, key header and model follow Sarvam's documentation as I last knew it and have
    // NOT been confirmed live: check them against docs.sarvam.ai. Its context is small, so longer requests go to the main vendor.
    sarvam: {
      name: 'sarvam',
      keyVar: 'SARVAM_API_KEY',
      authHeader: env('SARVAM_AUTH_HEADER') || 'api-subscription-key',
      apiKey: env('SARVAM_API_KEY'),
      baseUrl: stripSlash(env('SARVAM_BASE_URL') || 'https://api.sarvam.ai/v1'),
      model: env('SARVAM_MODEL') || 'sarvam-m',
      maxOutputTokens: num('SARVAM_MAX_OUTPUT_TOKENS', 3000, 256, 32000),
      timeoutMs: num('SARVAM_TIMEOUT_MS', 120_000, 5000, 600_000),
      maxInputChars: num('SARVAM_MAX_INPUT_CHARS', 12000, 500, 200000),
    },
    // Groq, also OpenAI-compatible; its free tier has small per-minute token limits, so long documents may be refused.
    groq: {
      name: 'groq',
      keyVar: 'GROQ_API_KEY',
      apiKey: env('GROQ_API_KEY'),
      baseUrl: stripSlash(env('GROQ_BASE_URL') || 'https://api.groq.com/openai/v1'),
      model: env('GROQ_MODEL') || 'openai/gpt-oss-120b',
      maxOutputTokens: num('GROQ_MAX_OUTPUT_TOKENS', 8000, 256, 128000),
      timeoutMs: num('GROQ_TIMEOUT_MS', 120_000, 5000, 600_000),
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
    : c.provider === 'openrouter' ? c.openrouter.model
    : c.provider === 'unorouter' ? c.unorouter.model
    : c.provider === 'groq' ? c.groq.model
    : c.provider === 'gemini' ? c.gemini.model
    : c.provider === 'sarvam' ? c.sarvam.model
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
