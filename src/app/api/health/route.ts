import { open } from '@/lib/http';
import { isAuthConfigured } from '@/lib/auth/provider';
import { aiConfig } from '@/lib/config';

function aiHealth() {
  try {
    const c = aiConfig();
    const keys = { sambanova: c.sambanova.apiKey, ollama: c.ollama.apiKey, anthropic: c.anthropic.apiKey } as const;
    const configured = c.provider === 'mock' ? true : Boolean(keys[c.provider]);
    return { provider: c.provider, configured };
  } catch (e) {
    return { provider: 'invalid', configured: false };
  }
}

// Reports configuration presence only (never values), for deployment checks.
export const GET = open(async () => ({
  ok: true,
  auth: isAuthConfigured(),
  database: Boolean(process.env.DATABASE_URL) || process.env.DATABASE_DRIVER === 'pglite',
  // Which AI vendor is selected and whether its key is present. "configured" means a key is set, NOT that it works:
  // use the "Test AI connection" button (Profile) for a real call.
  ai: aiHealth(),
}));
