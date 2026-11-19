import { open } from '@/lib/http';
import { isAuthConfigured } from '@/lib/auth/provider';

// Reports configuration presence only (never values), for deployment checks.
export const GET = open(async () => ({
  ok: true,
  auth: isAuthConfigured(),
  database: Boolean(process.env.DATABASE_URL) || process.env.DATABASE_DRIVER === 'pglite',
  ai: process.env.AI_PROVIDER === 'mock' ? 'mock' : Boolean(process.env.ANTHROPIC_API_KEY),
}));
