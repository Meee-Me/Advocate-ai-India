import { createHash, randomBytes } from 'node:crypto';
import { and, asc, count, desc, eq, gt, isNull, ne, or } from 'drizzle-orm';
import type { Db } from '@/lib/db';
import { advocates, hearings, officeInvites, officeMembers } from '@/lib/db/schema';
import { HttpError } from '@/lib/http-errors';

const INVITE_DAYS = 7;
const MAX_PENDING = 10;
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no I, L, O, 0, 1: they are easy to misread

const hashCode = (code: string) => createHash('sha256').update(code.toUpperCase().replace(/[^A-Z0-9]/g, '')).digest('hex');
const newCode = () => {
  const b = randomBytes(8);
  const c = Array.from(b, (x) => ALPHABET[x % ALPHABET.length]).join('');
  return `JR-${c.slice(0, 4)}-${c.slice(4)}`;
};

/** The office a person works in as a junior, or null when they run their own practice. */
export async function officeOf(db: Db, userId: string): Promise<{ ownerId: string } | null> {
  const [m] = await db.select({ ownerId: officeMembers.advocateId }).from(officeMembers).where(eq(officeMembers.memberId, userId));
  return m ?? null;
}

/** Everyone a hearing can be given to: the senior and the juniors. */
export async function assertAssignable(db: Db, ownerId: string, assigneeId: string | null | undefined) {
  if (!assigneeId || assigneeId === ownerId) return;
  const [m] = await db.select({ id: officeMembers.id }).from(officeMembers).where(and(eq(officeMembers.advocateId, ownerId), eq(officeMembers.memberId, assigneeId)));
  if (!m) throw new HttpError(400, 'That person is not in your office.', 'invalid');
}

export async function officeOverview(db: Db, userId: string) {
  const mine = await officeOf(db, userId);
  if (mine) {
    const [owner] = await db.select({ id: advocates.id, name: advocates.displayName }).from(advocates).where(eq(advocates.id, mine.ownerId));
    const mates = await db.select({ id: advocates.id, name: advocates.displayName }).from(officeMembers).innerJoin(advocates, eq(advocates.id, officeMembers.memberId)).where(eq(officeMembers.advocateId, mine.ownerId)).orderBy(asc(advocates.displayName));
    return { role: 'junior' as const, owner, members: [], invites: [], assignable: [owner, ...mates] };
  }
  const members = await db.select({ id: advocates.id, name: advocates.displayName, username: advocates.email, joinedAt: officeMembers.createdAt })
    .from(officeMembers).innerJoin(advocates, eq(advocates.id, officeMembers.memberId)).where(eq(officeMembers.advocateId, userId)).orderBy(asc(advocates.displayName));
  const invites = await db.select({ id: officeInvites.id, createdAt: officeInvites.createdAt, expiresAt: officeInvites.expiresAt })
    .from(officeInvites).where(and(eq(officeInvites.advocateId, userId), isNull(officeInvites.usedAt), gt(officeInvites.expiresAt, new Date()))).orderBy(desc(officeInvites.createdAt));
  const [me] = await db.select({ id: advocates.id, name: advocates.displayName }).from(advocates).where(eq(advocates.id, userId));
  return { role: 'senior' as const, owner: null, members, invites, assignable: [me, ...members.map((m) => ({ id: m.id, name: m.name }))] };
}

/** Makes a single-use code for a junior. Only its hash is kept, so the code can be shown exactly once. */
export async function createInvite(db: Db, ownerId: string) {
  if (await officeOf(db, ownerId)) throw new HttpError(403, 'Only the senior advocate can invite juniors.', 'forbidden');
  const [p] = await db.select({ n: count() }).from(officeInvites).where(and(eq(officeInvites.advocateId, ownerId), isNull(officeInvites.usedAt), gt(officeInvites.expiresAt, new Date())));
  if (p.n >= MAX_PENDING) throw new HttpError(409, 'Too many unused invites. Remove one first.', 'too_many');
  const code = newCode();
  const expiresAt = new Date(Date.now() + INVITE_DAYS * 864e5);
  await db.insert(officeInvites).values({ advocateId: ownerId, codeHash: hashCode(code), expiresAt });
  return { code, expiresAt };
}

export async function revokeInvite(db: Db, ownerId: string, id: string) {
  const r = await db.delete(officeInvites).where(and(eq(officeInvites.id, id), eq(officeInvites.advocateId, ownerId))).returning({ id: officeInvites.id });
  if (!r.length) throw new HttpError(404, 'Invite not found', 'not_found');
}

// shortcut: failed code attempts are counted in this server's memory, so the limit is per instance; move to the database if abuse is seen.
const failures = new Map<string, { n: number; since: number }>();
function throttle(userId: string, failed?: boolean) {
  const now = Date.now();
  const f = failures.get(userId);
  if (f && now - f.since > 15 * 60_000) failures.delete(userId);
  const cur = failures.get(userId);
  if (!failed) { if (cur && cur.n >= 10) throw new HttpError(429, 'Too many wrong codes. Please wait a few minutes.', 'rate_limited'); return; }
  failures.set(userId, { n: (cur?.n ?? 0) + 1, since: cur?.since ?? now });
}

/** A signed-in person joins an office with a code. Every failure says the same thing, so a code cannot be probed. */
export async function joinOffice(db: Db, userId: string, code: string) {
  throttle(userId);
  const bad = () => { throttle(userId, true); return new HttpError(400, 'That code is not valid or has expired.', 'invalid_code'); };
  if (await officeOf(db, userId)) throw new HttpError(409, 'You already work in an office. Leave it first.', 'already_member');
  const [hasJuniors] = await db.select({ n: count() }).from(officeMembers).where(eq(officeMembers.advocateId, userId));
  if (hasJuniors.n) throw new HttpError(409, 'You have juniors of your own, so you cannot join another office.', 'has_juniors');
  return db.transaction(async (tx) => {
    const [inv] = await tx.select().from(officeInvites).where(and(eq(officeInvites.codeHash, hashCode(code)), isNull(officeInvites.usedAt), gt(officeInvites.expiresAt, new Date()))).for('update');
    if (!inv || inv.advocateId === userId) throw bad();
    await tx.insert(officeMembers).values({ advocateId: inv.advocateId, memberId: userId });
    await tx.update(officeInvites).set({ usedAt: new Date(), usedBy: userId }).where(eq(officeInvites.id, inv.id));
    const [owner] = await tx.select({ name: advocates.displayName }).from(advocates).where(eq(advocates.id, inv.advocateId));
    return { ownerName: owner?.name ?? '' };
  });
}

/** The senior removes a junior, or a junior leaves. Hearings that were given to them become unassigned. */
export async function removeMember(db: Db, ownerId: string, memberId: string) {
  const r = await db.delete(officeMembers).where(and(eq(officeMembers.advocateId, ownerId), eq(officeMembers.memberId, memberId))).returning({ id: officeMembers.id });
  if (!r.length) throw new HttpError(404, 'Not in your office', 'not_found');
  await db.update(hearings).set({ assignedTo: null }).where(and(eq(hearings.advocateId, ownerId), eq(hearings.assignedTo, memberId)));
}
