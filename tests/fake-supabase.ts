import { parseCookies } from '@/lib/cookies';

/** In-memory stand-in for Supabase Auth, so tests never touch the network. The session cookie value is just the user id. */
export interface FakeUser { id: string; email: string; password: string; name: string; confirmed: boolean }
export const fakeUsers = new Map<string, FakeUser>();
export const fakeCodes = new Map<string, string>(); // one-use code -> user id

type Err = { name: string; status: number; code?: string };
const err = (status: number, code?: string, name = 'AuthApiError'): Err => ({ name, status, code });

export function fakeAuthFor(
  req: Request,
  real: { authCookieName: () => string; setCookieLine: (n: string, v: string, o?: { maxAge?: number }) => string; clearCookieLine: (n: string) => string },
) {
  const jar = parseCookies(req.headers.get('cookie'));
  const out: string[] = [];
  const name = real.authCookieName();
  const start = (u: FakeUser) => { out.push(real.setCookieLine(name, u.id)); };
  const toUser = (u: FakeUser) => ({ id: u.id, email: u.email, user_metadata: { full_name: u.name } });
  const auth = {
    async getUser() {
      const u = [...fakeUsers.values()].find((x) => x.id === jar[name]);
      return u ? { data: { user: toUser(u) }, error: null } : { data: { user: null }, error: err(400, undefined, 'AuthSessionMissingError') };
    },
    async signInWithPassword({ email, password }: { email: string; password: string }) {
      const u = fakeUsers.get(email);
      if (!u || u.password !== password) return { data: { user: null }, error: err(400, 'invalid_credentials') };
      if (!u.confirmed) return { data: { user: null }, error: err(400, 'email_not_confirmed') };
      start(u);
      return { data: { user: toUser(u) }, error: null };
    },
    async signUp({ email, password, options }: { email: string; password: string; options?: { data?: { full_name?: string } } }) {
      if (fakeUsers.has(email)) return { data: { user: null, session: null }, error: err(422, 'user_already_exists') };
      const u: FakeUser = { id: crypto.randomUUID(), email, password, name: options?.data?.full_name ?? '', confirmed: true };
      fakeUsers.set(email, u);
      start(u); // "Confirm email" is off in Supabase, so sign-up signs the person in
      return { data: { user: toUser(u), session: {} }, error: null };
    },
    async signOut() { out.push(real.clearCookieLine(name)); return { error: null }; },
    async exchangeCodeForSession(code: string) {
      const id = fakeCodes.get(code);
      const u = [...fakeUsers.values()].find((x) => x.id === id);
      if (!u) return { data: { user: null }, error: err(400, 'bad_code') };
      fakeCodes.delete(code); u.confirmed = true; start(u);
      return { data: { user: toUser(u) }, error: null };
    },
    async updateUser({ password }: { password: string }) {
      const u = [...fakeUsers.values()].find((x) => x.id === jar[name]);
      if (!u) return { data: { user: null }, error: err(401) };
      u.password = password;
      return { data: { user: toUser(u) }, error: null };
    },
  };
  return { supabase: { auth } as never, setCookies: () => out, headers: () => ({}) };
}
