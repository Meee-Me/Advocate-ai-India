import { and, asc, count, desc, eq, gte, ilike, inArray, isNull, lt, lte, or, sql, type SQL } from 'drizzle-orm';
import type { Db } from '@/lib/db';
import { alias } from 'drizzle-orm/pg-core';
import { advocates, caseNotes, cases, clients, documents, drafts, feeEntries, hearings, notifications } from '@/lib/db/schema';
import { assertAssignable } from './office';
import { notFound, badRequest } from '@/lib/http';
import { HttpError } from '@/lib/http-errors';

const like = (q: string) => `%${q.replace(/[\\%_]/g, '\\$&')}%`;
const clean = <T extends object>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;

/* ---------- ownership: a foreign key alone would accept another advocate's id ---------- */

export async function assertOwnsClient(db: Db, advocateId: string, id: string | null | undefined) {
  if (!id) return;
  const [r] = await db.select({ id: clients.id }).from(clients).where(and(eq(clients.id, id), eq(clients.advocateId, advocateId)));
  if (!r) throw badRequest('That client was not found.');
}
export async function assertOwnsCase(db: Db, advocateId: string, id: string | null | undefined) {
  if (!id) return;
  const [r] = await db.select({ id: cases.id }).from(cases).where(and(eq(cases.id, id), eq(cases.advocateId, advocateId)));
  if (!r) throw badRequest('That case was not found.');
}

/* ---------- clients ---------- */

type NewClient = Omit<typeof clients.$inferInsert, 'id' | 'advocateId' | 'createdAt' | 'updatedAt'>;

export async function listClients(db: Db, advocateId: string, o: { q?: string; limit: number; offset: number }) {
  const where: SQL[] = [eq(clients.advocateId, advocateId)];
  if (o.q) where.push(or(ilike(clients.name, like(o.q)), ilike(clients.email, like(o.q)), ilike(clients.phone, like(o.q)))!);
  return db.select().from(clients).where(and(...where)).orderBy(asc(sql`lower(${clients.name})`)).limit(o.limit).offset(o.offset);
}
export async function createClient(db: Db, advocateId: string, v: NewClient) {
  const [r] = await db.insert(clients).values({ ...v, advocateId }).returning();
  return r;
}
export async function getClient(db: Db, advocateId: string, id: string) {
  const [r] = await db.select().from(clients).where(and(eq(clients.id, id), eq(clients.advocateId, advocateId)));
  if (!r) throw notFound('Client not found');
  return r;
}
export async function updateClient(db: Db, advocateId: string, id: string, v: Partial<NewClient>) {
  const patch = clean(v);
  if (!Object.keys(patch).length) return getClient(db, advocateId, id);
  const [r] = await db.update(clients).set(patch).where(and(eq(clients.id, id), eq(clients.advocateId, advocateId))).returning();
  if (!r) throw notFound('Client not found');
  return r;
}
export async function deleteClient(db: Db, advocateId: string, id: string) {
  const [fees] = await db.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(feeEntries).where(and(eq(feeEntries.clientId, id), eq(feeEntries.advocateId, advocateId)));
  if (fees.n) throw new HttpError(409, 'This client has fees or invoices recorded, so they cannot be deleted.', 'has_fees');
  const r = await db.delete(clients).where(and(eq(clients.id, id), eq(clients.advocateId, advocateId))).returning({ id: clients.id });
  if (!r.length) throw notFound('Client not found');
}

/* ---------- cases ---------- */

type NewCase = Omit<typeof cases.$inferInsert, 'id' | 'advocateId' | 'createdAt' | 'updatedAt'>;

export async function listCases(db: Db, advocateId: string, o: { q?: string; status?: string; clientId?: string; limit: number; offset: number }) {
  const where: SQL[] = [eq(cases.advocateId, advocateId)];
  if (o.status) where.push(eq(cases.status, o.status));
  if (o.clientId) where.push(eq(cases.clientId, o.clientId));
  if (o.q) {
    const p = like(o.q);
    where.push(or(ilike(cases.title, p), ilike(cases.caseNumber, p), ilike(cases.cnrNumber, p), ilike(cases.petitioner, p), ilike(cases.respondent, p), ilike(cases.court, p))!);
  }
  const rows = await db
    .select({ case: cases, clientName: clients.name })
    .from(cases)
    .leftJoin(clients, eq(clients.id, cases.clientId))
    .where(and(...where))
    .orderBy(desc(cases.updatedAt))
    .limit(o.limit)
    .offset(o.offset);
  return rows.map((r) => ({ ...r.case, clientName: r.clientName }));
}
export async function createCase(db: Db, advocateId: string, v: NewCase) {
  await assertOwnsClient(db, advocateId, v.clientId);
  const [r] = await db.insert(cases).values({ ...v, advocateId }).returning();
  return r;
}
export async function getCase(db: Db, advocateId: string, id: string) {
  const [r] = await db.select().from(cases).where(and(eq(cases.id, id), eq(cases.advocateId, advocateId)));
  if (!r) throw notFound('Case not found');
  return r;
}
export async function getCaseDetail(db: Db, advocateId: string, id: string) {
  const c = await getCase(db, advocateId, id);
  const [client, hs, notes, docs, ds] = await Promise.all([
    c.clientId ? db.select().from(clients).where(and(eq(clients.id, c.clientId), eq(clients.advocateId, advocateId))).then((r) => r[0] ?? null) : null,
    db.select().from(hearings).where(and(eq(hearings.caseId, id), eq(hearings.advocateId, advocateId))).orderBy(desc(hearings.hearingAt)),
    db.select().from(caseNotes).where(and(eq(caseNotes.caseId, id), eq(caseNotes.advocateId, advocateId))).orderBy(desc(caseNotes.createdAt)),
    db.select({ id: documents.id, title: documents.title, fileName: documents.fileName, status: documents.status, pageCount: documents.pageCount, createdAt: documents.createdAt })
      .from(documents).where(and(eq(documents.caseId, id), eq(documents.advocateId, advocateId))).orderBy(desc(documents.createdAt)),
    db.select({ id: drafts.id, title: drafts.title, docType: drafts.docType, updatedAt: drafts.updatedAt })
      .from(drafts).where(and(eq(drafts.caseId, id), eq(drafts.advocateId, advocateId))).orderBy(desc(drafts.updatedAt)),
  ]);
  return { case: c, client, hearings: hs, notes, documents: docs, drafts: ds };
}
export async function updateCase(db: Db, advocateId: string, id: string, v: Partial<NewCase>) {
  if (v.clientId !== undefined) await assertOwnsClient(db, advocateId, v.clientId);
  const patch = clean(v);
  if (!Object.keys(patch).length) return getCase(db, advocateId, id);
  const [r] = await db.update(cases).set(patch).where(and(eq(cases.id, id), eq(cases.advocateId, advocateId))).returning();
  if (!r) throw notFound('Case not found');
  return r;
}
export async function deleteCase(db: Db, advocateId: string, id: string) {
  const r = await db.delete(cases).where(and(eq(cases.id, id), eq(cases.advocateId, advocateId))).returning({ id: cases.id });
  if (!r.length) throw notFound('Case not found');
}
export async function addNote(db: Db, advocateId: string, caseId: string, body: string) {
  await getCase(db, advocateId, caseId);
  const [r] = await db.insert(caseNotes).values({ advocateId, caseId, body }).returning();
  await db.update(cases).set({ updatedAt: new Date() }).where(eq(cases.id, caseId));
  return r;
}
export async function deleteNote(db: Db, advocateId: string, caseId: string, noteId: string) {
  const r = await db.delete(caseNotes).where(and(eq(caseNotes.id, noteId), eq(caseNotes.caseId, caseId), eq(caseNotes.advocateId, advocateId))).returning({ id: caseNotes.id });
  if (!r.length) throw notFound('Note not found');
}

/* ---------- hearings ---------- */

type NewHearing = Omit<typeof hearings.$inferInsert, 'id' | 'advocateId' | 'createdAt' | 'updatedAt' | 'remindedAt'>;

const assignee = alias(advocates, 'assignee');
const hearingWithCase = {
  hearing: hearings,
  caseTitle: cases.title,
  caseNumber: cases.caseNumber,
  assignedName: assignee.displayName,
};

export async function listHearings(db: Db, advocateId: string, o: { from?: Date; to?: Date; caseId?: string; status?: string; limit: number; offset: number }) {
  const where: SQL[] = [eq(hearings.advocateId, advocateId)];
  if (o.from) where.push(gte(hearings.hearingAt, o.from));
  if (o.to) where.push(lt(hearings.hearingAt, o.to));
  if (o.caseId) where.push(eq(hearings.caseId, o.caseId));
  if (o.status) where.push(eq(hearings.status, o.status));
  const rows = await db.select(hearingWithCase).from(hearings).innerJoin(cases, eq(cases.id, hearings.caseId)).leftJoin(assignee, eq(assignee.id, hearings.assignedTo))
    .where(and(...where)).orderBy(asc(hearings.hearingAt)).limit(o.limit).offset(o.offset);
  return rows.map((r) => ({ ...r.hearing, caseTitle: r.caseTitle, caseNumber: r.caseNumber, assignedName: r.assignedName }));
}
export async function createHearing(db: Db, advocateId: string, v: NewHearing) {
  await assertOwnsCase(db, advocateId, v.caseId);
  await assertAssignable(db, advocateId, v.assignedTo);
  const [r] = await db.insert(hearings).values({ ...v, advocateId }).returning();
  return r;
}
export async function updateHearing(db: Db, advocateId: string, id: string, v: Partial<Omit<NewHearing, 'caseId'>>) {
  await assertAssignable(db, advocateId, v.assignedTo);
  const patch: Record<string, unknown> = clean(v);
  if (!Object.keys(patch).length) {
    const [r] = await db.select().from(hearings).where(and(eq(hearings.id, id), eq(hearings.advocateId, advocateId)));
    if (!r) throw notFound('Hearing not found');
    return r;
  }
  // A changed date, reminder time or status makes any earlier reminder stale.
  if (v.hearingAt !== undefined || v.remindBeforeMinutes !== undefined || v.status !== undefined) patch.remindedAt = null;
  const [r] = await db.update(hearings).set(patch).where(and(eq(hearings.id, id), eq(hearings.advocateId, advocateId))).returning();
  if (!r) throw notFound('Hearing not found');
  if ('remindedAt' in patch) {
    await db.delete(notifications).where(and(eq(notifications.hearingId, id), eq(notifications.kind, 'hearing_reminder'), isNull(notifications.readAt)));
  }
  return r;
}
export async function deleteHearing(db: Db, advocateId: string, id: string) {
  const r = await db.delete(hearings).where(and(eq(hearings.id, id), eq(hearings.advocateId, advocateId))).returning({ id: hearings.id });
  if (!r.length) throw notFound('Hearing not found');
}

/* ---------- reminders & notifications ---------- */

const when = (d: Date) =>
  new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }).format(d) + ' IST';

/**
 * Creates an in-app notification for each scheduled hearing whose reminder time
 * falls before `now + lookaheadMinutes` (the gap until the next run), once each.
 * Reminders never arrive late; with a daily schedule they may arrive up to a day early.
 */
export async function runReminders(db: Db, now: Date, lookaheadMinutes: number) {
  const horizon = new Date(now.getTime() + lookaheadMinutes * 60_000);
  const due = await db
    .select({ h: hearings, title: cases.title, number: cases.caseNumber })
    .from(hearings)
    .innerJoin(cases, eq(cases.id, hearings.caseId))
    .where(and(
      eq(hearings.status, 'scheduled'),
      isNull(hearings.remindedAt),
      gte(hearings.hearingAt, now),
      sql`${hearings.hearingAt} - (${hearings.remindBeforeMinutes} * interval '1 minute') <= ${horizon.toISOString()}::timestamptz`,
    ))
    .limit(1000);
  let created = 0;
  for (const { h, title, number } of due) {
    // Claim first, so overlapping runs cannot notify twice.
    const claimed = await db.update(hearings).set({ remindedAt: now })
      .where(and(eq(hearings.id, h.id), isNull(hearings.remindedAt))).returning({ id: hearings.id });
    if (!claimed.length) continue;
    const details = [h.purpose, h.court ?? undefined, h.courtroom ? `Court ${h.courtroom}` : undefined, number ?? undefined].filter(Boolean).join(' · ');
    await db.insert(notifications).values({
      advocateId: h.advocateId,
      kind: 'hearing_reminder',
      hearingId: h.id,
      title: `Hearing ${when(h.hearingAt)}: ${title}`,
      body: details || null,
    });
    created++;
  }
  return { checked: due.length, created };
}

export async function listNotifications(db: Db, advocateId: string, limit = 50) {
  const [items, [unread]] = await Promise.all([
    db.select().from(notifications).where(eq(notifications.advocateId, advocateId)).orderBy(desc(notifications.createdAt)).limit(limit),
    db.select({ n: count() }).from(notifications).where(and(eq(notifications.advocateId, advocateId), isNull(notifications.readAt))),
  ]);
  return { items, unread: unread.n };
}
export async function markNotificationsRead(db: Db, advocateId: string, o: { ids?: string[]; all?: boolean }) {
  const base = and(eq(notifications.advocateId, advocateId), isNull(notifications.readAt));
  const where = o.all ? base : o.ids?.length ? and(base, inArray(notifications.id, o.ids)) : undefined;
  if (!where) return 0;
  const r = await db.update(notifications).set({ readAt: new Date() }).where(where).returning({ id: notifications.id });
  return r.length;
}

/* ---------- dashboard ---------- */

export async function dashboard(db: Db, advocateId: string, now = new Date()) {
  const in7 = new Date(now.getTime() + 7 * 864e5);
  const mine = (t: { advocateId: unknown }) => eq(t.advocateId as never, advocateId);
  const [[openCases], [clientCount], [docCount], [week], upcoming, recent, notes] = await Promise.all([
    db.select({ n: count() }).from(cases).where(and(mine(cases), inArray(cases.status, ['open', 'pending']))),
    db.select({ n: count() }).from(clients).where(mine(clients)),
    db.select({ n: count() }).from(documents).where(and(mine(documents), eq(documents.status, 'uploaded'))),
    db.select({ n: count() }).from(hearings).where(and(mine(hearings), eq(hearings.status, 'scheduled'), gte(hearings.hearingAt, now), lte(hearings.hearingAt, in7))),
    listHearings(db, advocateId, { from: now, status: 'scheduled', limit: 8, offset: 0 }),
    listCases(db, advocateId, { limit: 5, offset: 0 }),
    listNotifications(db, advocateId, 5),
  ]);
  return {
    stats: { openCases: openCases.n, clients: clientCount.n, documents: docCount.n, hearingsThisWeek: week.n, unreadNotifications: notes.unread },
    upcomingHearings: upcoming,
    recentCases: recent,
    notifications: notes.items,
  };
}

/* ---------- cause list ---------- */

/** Just enough of each case to match a printed case number to it. */
export async function listCasesForMatching(db: Db, advocateId: string) {
  return db.select({ id: cases.id, title: cases.title, caseNumber: cases.caseNumber, cnrNumber: cases.cnrNumber })
    .from(cases).where(eq(cases.advocateId, advocateId)).limit(5000);
}

/**
 * Saves reviewed cause-list rows as hearings. A case that already has a hearing that day is updated (item number, bench,
 * court hall, purpose) instead of getting a second one. Returns how many were added and how many updated.
 */
export async function applyCauseList(
  db: Db, advocateId: string,
  o: { at: Date; dayFrom: Date; dayTo: Date; court?: string | null; rows: { caseId: string; itemNumber?: string | null; bench?: string | null; courtroom?: string | null; purpose?: string | null }[] },
) {
  // Check every case first, so one bad row cannot leave the others half saved.
  for (const caseId of new Set(o.rows.map((r) => r.caseId))) await assertOwnsCase(db, advocateId, caseId);
  const existing = await listHearings(db, advocateId, { from: o.dayFrom, to: o.dayTo, limit: 500, offset: 0 });
  let created = 0, updated = 0;
  const seen = new Set<string>();
  for (const r of o.rows) {
    if (seen.has(r.caseId)) continue; // a case listed twice in one paste is saved once
    seen.add(r.caseId);
    const details = { itemNumber: r.itemNumber ?? null, bench: r.bench ?? null, courtroom: r.courtroom ?? null, purpose: r.purpose ?? null, court: o.court ?? null };
    const same = existing.find((h) => h.caseId === r.caseId && h.status === 'scheduled');
    if (same) { await updateHearing(db, advocateId, same.id, details); updated++; }
    else { await createHearing(db, advocateId, { caseId: r.caseId, hearingAt: o.at, status: 'scheduled', remindBeforeMinutes: 1440, notes: null, ...details }); created++; }
  }
  return { created, updated };
}
