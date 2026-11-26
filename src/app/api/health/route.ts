import { open } from '@/lib/http';
import { aiConfig, isAuthConfigured, signupCode } from '@/lib/config';


function aiHealth() {
  try {
    const c = aiConfig();
    const keys = { sambanova: c.sambanova.apiKey, ollama: c.ollama.apiKey, openrouter: c.openrouter.apiKey, unorouter: c.unorouter.apiKey, groq: c.groq.apiKey, gemini: c.gemini.apiKey, sarvam: c.sarvam.apiKey, anthropic: c.anthropic.apiKey } as const;
    const has = (n: keyof typeof keys | null | undefined) => (n && keys[n] ? n : null);
    const configured = c.provider === 'mock' ? true : Boolean(keys[c.provider]);
    // Every vendor that can really receive a request (key present): the consent box names them all.
    const vendors = [...new Set([c.provider, c.routes.task, c.routes.malayalam, c.backup].map((n) => (n === 'mock' ? null : has(n))).filter(Boolean))];
    const backup = has(c.backup) ?? undefined;
    return { provider: c.provider, configured, ...(backup ? { backup } : {}), vendors };
  } catch (e) {
    return { provider: 'invalid', configured: false, vendors: [] };
  }
}

// Reports configuration presence only (never values), for deployment checks.
export const GET = open(async () => ({
  ok: true,
  auth: isAuthConfigured(),
  // The sign-up page asks for an invite code only when one is required. The code itself is never shown.
  signupInvite: Boolean(signupCode()),
  database: Boolean(process.env.DATABASE_URL) || process.env.DATABASE_DRIVER === 'pglite',
  // Which AI vendor is selected and whether its key is present. "configured" means a key is set, NOT that it works:
  // use the "Test AI connection" button (Profile) for a real call.
  ai: aiHealth(),
}));
