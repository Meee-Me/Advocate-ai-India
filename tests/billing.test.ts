import { beforeAll, describe, expect, it } from 'vitest';
import * as clientsRoute from '@/app/api/clients/route';
import * as clientRoute from '@/app/api/clients/[id]/route';
import * as casesRoute from '@/app/api/cases/route';
import * as entriesRoute from '@/app/api/billing/entries/route';
import * as entryRoute from '@/app/api/billing/entries/[id]/route';
import * as summaryRoute from '@/app/api/billing/summary/route';
import * as invoicesRoute from '@/app/api/billing/invoices/route';
import * as invoiceRoute from '@/app/api/billing/invoices/[id]/route';
import { formatRupees, rupeesToPaise } from '@/lib/money';
import { call, setup, signIn, type Who } from './harness';

describe('money', () => {
  it('reads what people type as whole paise and refuses the rest', () => {
    expect(rupeesToPaise('1500')).toBe(150000);
    expect(rupeesToPaise('₹1,50,000.5')).toBe(15000050);
    expect(rupeesToPaise(2500.75)).toBe(250075);
    for (const bad of ['0', '-5', '12.345', 'abc', '', '1e5', '999999999999']) expect(rupeesToPaise(bad)).toBeNull();
  });
  it('shows rupees with Indian digit grouping', () => {
    expect(formatRupees(12500050)).toBe('₹1,25,000.50');
    expect(formatRupees(150000)).toBe('₹1,500');
    expect(formatRupees(-5000)).toBe('-₹50');
  });
});

describe('billing', () => {
  let A: Who;
  let B: Who;
  let client: string;
  let caseId: string;
  let theirs: string;
  const day = '2026-11-25';
  const add = (who: Who, body: Record<string, unknown>) => call(entriesRoute.POST, 'POST', '/api/billing/entries', { who, body: { incurredOn: day, ...body } });
  beforeAll(async () => {
    await setup(); A = await signIn('Fees'); B = await signIn('Rival');
    client = (await call(clientsRoute.POST, 'POST', '/api/clients', { who: A, body: { name: 'Ravi Kumar' } })).data.client.id;
    caseId = (await call(casesRoute.POST, 'POST', '/api/cases', { who: A, body: { title: 'Ravi v State', clientId: client } })).data.case.id;
    theirs = (await call(clientsRoute.POST, 'POST', '/api/clients', { who: B, body: { name: 'Other client' } })).data.client.id;
  });

  it('needs sign-in, a valid kind and a real amount', async () => {
    expect((await call(entriesRoute.GET, 'GET', '/api/billing/entries')).status).toBe(401);
    expect((await add(A, { clientId: client, kind: 'gift', amount: '100' })).status).toBe(400);
    expect((await add(A, { clientId: client, kind: 'expense', amount: '12.345' })).status).toBe(400);
    expect((await add(A, { clientId: client, kind: 'expense', amount: '0' })).status).toBe(400);
  });

  it('records fees and payments, and shows what each client owes', async () => {
    expect((await add(A, { clientId: client, caseId, kind: 'professional_fee', amount: '25,000', note: 'Drafting' })).status).toBe(201);
    expect((await add(A, { clientId: client, kind: 'court_fee', amount: '1500.50' })).status).toBe(201);
    expect((await add(A, { clientId: client, kind: 'retainer', amount: '10000' })).status).toBe(201);
    const s = (await call(summaryRoute.GET, 'GET', '/api/billing/summary', { who: A })).data;
    expect(s.clients).toEqual([expect.objectContaining({ clientName: 'Ravi Kumar', charged: 2650050, received: 1000000, balance: 1650050, unbilled: 2650050 })]);
    expect(s.totalDue).toBe(1650050);
    expect(s.advanceHeld).toBe(0);
    const unbilled = (await call(entriesRoute.GET, 'GET', '/api/billing/entries?unbilled=1', { who: A })).data.entries;
    expect(unbilled).toHaveLength(2); // the retainer is money received, so it is not billable
  });

  it('keeps one advocate out of another’s clients, cases and figures', async () => {
    expect((await add(B, { clientId: client, kind: 'expense', amount: '10' })).status).toBe(400);
    expect((await add(A, { clientId: theirs, kind: 'expense', amount: '10' })).status).toBe(400);
    expect((await call(summaryRoute.GET, 'GET', '/api/billing/summary', { who: B })).data.clients).toEqual([]);
  });

  it('creates numbered invoices from unbilled charges only, and locks what is on them', async () => {
    const entries = (await call(entriesRoute.GET, 'GET', '/api/billing/entries?unbilled=1', { who: A })).data.entries as { id: string }[];
    const ids = entries.map((e) => e.id);
    const retainer = (await call(entriesRoute.GET, 'GET', '/api/billing/entries?clientId=' + client, { who: A })).data.entries.find((e: { kind: string }) => e.kind === 'retainer').id as string;
    expect((await call(invoicesRoute.POST, 'POST', '/api/billing/invoices', { who: A, body: { clientId: client, entryIds: [retainer], issuedOn: day } })).status).toBe(400);
    expect((await call(invoicesRoute.POST, 'POST', '/api/billing/invoices', { who: B, body: { clientId: theirs, entryIds: ids, issuedOn: day } })).status).toBe(400);
    const made = await call(invoicesRoute.POST, 'POST', '/api/billing/invoices', { who: A, body: { clientId: client, entryIds: ids, issuedOn: day, note: 'Thank you' } });
    expect(made.status).toBe(201);
    expect(made.data.invoice).toMatchObject({ number: 'INV-2026-0001', seq: 1, totalPaise: 2650050 });
    const again = await call(invoicesRoute.POST, 'POST', '/api/billing/invoices', { who: A, body: { clientId: client, entryIds: ids, issuedOn: day } });
    expect(again.status).toBe(409); // already invoiced
    expect((await call(entryRoute.DELETE, 'DELETE', `/api/billing/entries/${ids[0]}`, { who: A, params: { id: ids[0] } })).status).toBe(409);
    const got = (await call(invoiceRoute.GET, 'GET', `/api/billing/invoices/${made.data.invoice.id}`, { who: A, params: { id: made.data.invoice.id } })).data;
    expect(got.items).toHaveLength(2);
    expect(got.client.name).toBe('Ravi Kumar');
    expect((await call(invoiceRoute.GET, 'GET', `/api/billing/invoices/${made.data.invoice.id}`, { who: B, params: { id: made.data.invoice.id } })).status).toBe(404);
    // The next invoice continues the numbering.
    const next = (await add(A, { clientId: client, kind: 'expense', amount: '300' })).data.entry.id as string;
    const second = await call(invoicesRoute.POST, 'POST', '/api/billing/invoices', { who: A, body: { clientId: client, entryIds: [next], issuedOn: day } });
    expect(second.data.invoice.number).toBe('INV-2026-0002');
  });

  it('lets an unbilled entry be deleted, and keeps a client with fees from being deleted', async () => {
    const e = (await add(A, { clientId: client, kind: 'payment', amount: '50' })).data.entry.id as string;
    expect((await call(entryRoute.DELETE, 'DELETE', `/api/billing/entries/${e}`, { who: A, params: { id: e } })).status).toBe(200);
    const del = await call(clientRoute.DELETE, 'DELETE', `/api/clients/${client}`, { who: A, params: { id: client } });
    expect(del.status).toBe(409);
    expect(del.data.error).toMatch(/fees or invoices/);
  });
});
