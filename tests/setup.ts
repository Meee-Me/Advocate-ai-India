import { vi } from 'vitest';
import { fakeAuthFor } from './fake-supabase';

vi.mock('@/lib/auth/supabase', async (orig) => {
  const real = await orig<typeof import('@/lib/auth/supabase')>();
  return { ...real, authFor: (req: Request) => fakeAuthFor(req, real) };
});
