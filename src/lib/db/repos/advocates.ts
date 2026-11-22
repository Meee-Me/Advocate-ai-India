import { eq } from 'drizzle-orm';
import type { Db } from '@/lib/db';
import { advocates } from '@/lib/db/schema';
import type { ProfileInput } from '@/lib/validation';

export type Advocate = typeof advocates.$inferSelect;

// Remembers which ids are known to exist, per database connection, so the check below costs one query per person
// per server instance rather than one per request.
const known = new WeakMap<object, Set<string>>();

/**
 * Makes sure the signed-in person has an advocate row. The row's id IS the Supabase Auth user id, which is what lets
 * every table's advocate_id match auth.uid(). Does nothing if the row exists (never overwrites a profile).
 */
export async function ensureAdvocate(db: Db, user: { id: string; name: string; email?: string | null }): Promise<void> {
  let ids = known.get(db);
  if (!ids) known.set(db, (ids = new Set()));
  if (ids.has(user.id)) return;
  await db.insert(advocates).values({ id: user.id, displayName: user.name, email: user.email || null }).onConflictDoNothing({ target: advocates.id });
  if (ids.size > 5000) ids.clear();
  ids.add(user.id);
}

export async function touchLastLogin(db: Db, id: string): Promise<void> {
  await db.update(advocates).set({ lastLoginAt: new Date() }).where(eq(advocates.id, id));
}

export async function getAdvocate(db: Db, id: string): Promise<Advocate | null> {
  const [row] = await db.select().from(advocates).where(eq(advocates.id, id));
  return row ?? null;
}

export async function updateProfile(db: Db, id: string, input: ProfileInput): Promise<Advocate | null> {
  const patch = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
  if (!Object.keys(patch).length) return getAdvocate(db, id);
  const [row] = await db.update(advocates).set(patch).where(eq(advocates.id, id)).returning();
  return row ?? null;
}
