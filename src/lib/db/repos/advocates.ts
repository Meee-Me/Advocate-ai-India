import { eq, sql } from 'drizzle-orm';
import type { Db } from '@/lib/db';
import { advocates } from '@/lib/db/schema';
import type { DeluxeUser } from '@/lib/auth/provider';
import type { ProfileInput } from '@/lib/validation';

export type Advocate = typeof advocates.$inferSelect;

/** Creates the advocate on first sign-in, refreshes name/handle on later ones. */
export async function upsertFromDeluxe(db: Db, user: DeluxeUser): Promise<Advocate> {
  const [row] = await db
    .insert(advocates)
    .values({ deluxeAccountId: user.id, displayName: user.name, deluxeHandle: user.handle ?? null, lastLoginAt: new Date() })
    .onConflictDoUpdate({
      target: advocates.deluxeAccountId,
      set: { displayName: sql`excluded.display_name`, deluxeHandle: sql`excluded.deluxe_handle`, lastLoginAt: new Date() },
    })
    .returning();
  return row;
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
