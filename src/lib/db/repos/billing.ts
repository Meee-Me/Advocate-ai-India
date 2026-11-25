import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Db } from '@/lib/db';
import { advocates, cases, clients, feeEntries, invoices } from '@/lib/db/schema';
import { notFound } from '@/lib/http';
import { HttpError } from '@/lib/http-errors';
import { CHARGE_KINDS, CREDIT_KINDS, isCharge } from '@/lib/money';
import { assertOwnsCase, assertOwnsClient } from './practice';

type NewEntry = { clientId: string; caseId?: string | null; kind: string; amount: number; incurredOn: string; note?: string | null };

export async function createEntry(db: Db, advocateId: string, v: NewEntry) {
  await assertOwnsClient(db, advocateId, v.clientId);
  await assertOwnsCase(db, advocateId, v.caseId);
  const [r] = await db.insert(feeEntries).values({
    advocateId, clientId: v.clientId, caseId: v.caseId ?? null, kind: v.kind, amountPaise: v.amount, incurredOn: v.incurredOn, note: v.note ?? null,
  }).returning();
  return r;
}

export async function listEntries(db: Db, advocateId: string, o: { clientId?: string; unbilled?: boolean; limit: number }) {
  const where = [eq(feeEntries.advocateId, advocateId)];
  if (o.clientId) where.push(eq(feeEntries.clientId, o.clientId));
  if (o.unbilled) { where.push(isNull(feeEntries.invoiceId)); where.push(inArray(feeEntries.kind, [...CHARGE_KINDS])); }
  const rows = await db.select({ e: feeEntries, clientName: clients.name, caseTitle: cases.title, invoiceNumber: invoices.number })
    .from(feeEntries)
    .innerJoin(clients, eq(clients.id, feeEntries.clientId))
    .leftJoin(cases, eq(cases.id, feeEntries.caseId))
    .leftJoin(invoices, eq(invoices.id, feeEntries.invoiceId))
    .where(and(...where)).orderBy(desc(feeEntries.incurredOn), desc(feeEntries.createdAt)).limit(o.limit);
  return rows.map((r) => ({ ...r.e, clientName: r.clientName, caseTitle: r.caseTitle, invoiceNumber: r.invoiceNumber }));
}

/** An entry that is on an invoice is part of a document the client may hold, so it cannot be removed. */
export async function deleteEntry(db: Db, advocateId: string, id: string) {
  const [e] = await db.select().from(feeEntries).where(and(eq(feeEntries.id, id), eq(feeEntries.advocateId, advocateId)));
  if (!e) throw notFound('Entry not found');
  if (e.invoiceId) throw new HttpError(409, 'This entry is on an invoice, so it cannot be deleted.', 'on_invoice');
  await db.delete(feeEntries).where(eq(feeEntries.id, id));
}

/** Per client: charged, received, and what is due (negative = advance held). */
export async function billingSummary(db: Db, advocateId: string) {
  const charge = sql`sum(case when ${feeEntries.kind} in (${sql.join(CHARGE_KINDS.map((k) => sql`${k}`), sql`, `)}) then ${feeEntries.amountPaise} else 0 end)`;
  const credit = sql`sum(case when ${feeEntries.kind} in (${sql.join(CREDIT_KINDS.map((k) => sql`${k}`), sql`, `)}) then ${feeEntries.amountPaise} else 0 end)`;
  const unbilled = sql`sum(case when ${feeEntries.invoiceId} is null and ${feeEntries.kind} in (${sql.join(CHARGE_KINDS.map((k) => sql`${k}`), sql`, `)}) then ${feeEntries.amountPaise} else 0 end)`;
  const rows = await db.select({ clientId: feeEntries.clientId, clientName: clients.name, charged: charge.mapWith(Number), received: credit.mapWith(Number), unbilled: unbilled.mapWith(Number) })
    .from(feeEntries).innerJoin(clients, eq(clients.id, feeEntries.clientId))
    .where(eq(feeEntries.advocateId, advocateId)).groupBy(feeEntries.clientId, clients.name).orderBy(asc(clients.name));
  const clientsOut = rows.map((r) => ({ ...r, balance: r.charged - r.received }));
  return {
    clients: clientsOut,
    totalDue: clientsOut.reduce((n, c) => n + Math.max(c.balance, 0), 0),
    advanceHeld: clientsOut.reduce((n, c) => n + Math.max(-c.balance, 0), 0),
  };
}

/** Makes the next invoice number for this advocate, e.g. INV-2026-0007, and attaches the chosen unbilled charges to it. */
export async function createInvoice(db: Db, advocateId: string, v: { clientId: string; entryIds: string[]; issuedOn: string; note?: string | null }) {
  await assertOwnsClient(db, advocateId, v.clientId);
  const ids = [...new Set(v.entryIds)];
  return db.transaction(async (tx) => {
    const picked = await tx.select().from(feeEntries).where(and(eq(feeEntries.advocateId, advocateId), eq(feeEntries.clientId, v.clientId), inArray(feeEntries.id, ids)));
    if (picked.length !== ids.length) throw new HttpError(400, 'Some of those entries were not found for this client.', 'invalid');
    if (picked.some((e) => e.invoiceId)) throw new HttpError(409, 'One of those entries is already on an invoice.', 'on_invoice');
    if (picked.some((e) => !isCharge(e.kind))) throw new HttpError(400, 'Only fees and expenses go on an invoice, not payments.', 'invalid');
    const total = picked.reduce((n, e) => n + e.amountPaise, 0);
    const [last] = await tx.select({ m: sql<number>`coalesce(max(${invoices.seq}), 0)`.mapWith(Number) }).from(invoices).where(eq(invoices.advocateId, advocateId));
    const seq = last.m + 1;
    const number = `INV-${v.issuedOn.slice(0, 4)}-${String(seq).padStart(4, '0')}`;
    const [inv] = await tx.insert(invoices).values({ advocateId, clientId: v.clientId, seq, number, issuedOn: v.issuedOn, totalPaise: total, note: v.note ?? null }).returning();
    await tx.update(feeEntries).set({ invoiceId: inv.id }).where(inArray(feeEntries.id, ids));
    return inv;
  });
}

export async function listInvoices(db: Db, advocateId: string) {
  return (await db.select({ i: invoices, clientName: clients.name }).from(invoices).innerJoin(clients, eq(clients.id, invoices.clientId))
    .where(eq(invoices.advocateId, advocateId)).orderBy(desc(invoices.seq)).limit(200)).map((r) => ({ ...r.i, clientName: r.clientName }));
}

export async function getInvoice(db: Db, advocateId: string, id: string) {
  const [inv] = await db.select().from(invoices).where(and(eq(invoices.id, id), eq(invoices.advocateId, advocateId)));
  if (!inv) throw notFound('Invoice not found');
  const [client] = await db.select().from(clients).where(eq(clients.id, inv.clientId));
  const items = await db.select({ e: feeEntries, caseTitle: cases.title, caseNumber: cases.caseNumber }).from(feeEntries)
    .leftJoin(cases, eq(cases.id, feeEntries.caseId)).where(eq(feeEntries.invoiceId, id)).orderBy(asc(feeEntries.incurredOn));
  const [adv] = await db.select({ displayName: advocates.displayName, enrolmentNumber: advocates.enrolmentNumber, barCouncil: advocates.barCouncil, phone: advocates.phone, city: advocates.city, state: advocates.state })
    .from(advocates).where(eq(advocates.id, advocateId));
  return { invoice: inv, client, advocate: adv, items: items.map((r) => ({ ...r.e, caseTitle: r.caseTitle, caseNumber: r.caseNumber })) };
}
