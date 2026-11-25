import { beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import * as officeRoute from '@/app/api/office/route';
import * as inviteRoute from '@/app/api/office/invite/route';
import * as inviteIdRoute from '@/app/api/office/invite/[id]/route';
import * as joinRoute from '@/app/api/office/join/route';
import * as leaveRoute from '@/app/api/office/leave/route';
import * as memberRoute from '@/app/api/office/members/[id]/route';
import * as casesRoute from '@/app/api/cases/route';
import * as caseRoute from '@/app/api/cases/[id]/route';
import * as clientsRoute from '@/app/api/clients/route';
import * as clientRoute from '@/app/api/clients/[id]/route';
import * as hearingsRoute from '@/app/api/hearings/route';
import * as summaryRoute from '@/app/api/billing/summary/route';
import * as entriesRoute from '@/app/api/billing/entries/route';
import * as profileRoute from '@/app/api/profile/route';
import { getDb, schema } from '@/lib/db';
import { call, setup, signIn, type Who } from './harness';

describe('offices and juniors', () => {
  let S: Who; // senior
  let J: Who; // junior
  let K: Who; // a second junior
  let X: Who; // an advocate outside the office
  let seniorCase: string;
  let client: string;
  const invite = async (who: Who) => (await call(inviteRoute.POST, 'POST', '/api/office/invite', { who, body: {} }));
  const join = (who: Who, code: string) => call(joinRoute.POST, 'POST', '/api/office/join', { who, body: { code } });
  const cases = async (who: Who) => (await call(casesRoute.GET, 'GET', '/api/cases', { who })).data.cases as { id: string; title: string }[];

  beforeAll(async () => {
    await setup();
    S = await signIn('Senior'); J = await signIn('Junior'); K = await signIn('Junior2'); X = await signIn('Outsider');
    client = (await call(clientsRoute.POST, 'POST', '/api/clients', { who: S, body: { name: 'Ravi' } })).data.client.id;
    seniorCase = (await call(casesRoute.POST, 'POST', '/api/cases', { who: S, body: { title: 'Senior case', clientId: client, fileLocation: 'Almirah 3, shelf B' } })).data.case.id;
  });

  it('gives the senior a single-use code that is never listed again', async () => {
    const r = await invite(S);
    expect(r.status).toBe(201);
    expect(r.data.code).toMatch(/^JR-[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/);
    const o = (await call(officeRoute.GET, 'GET', '/api/office', { who: S })).data;
    expect(o.role).toBe('senior');
    expect(o.invites).toHaveLength(1);
    expect(JSON.stringify(o)).not.toContain(r.data.code);
    (globalThis as { __code?: string }).__code = r.data.code;
  });

  it('lets a junior join with the code, once, and refuses wrong, reused and own codes', async () => {
    const code = (globalThis as { __code?: string }).__code!;
    expect((await join(J, 'JR-AAAA-BBBB')).status).toBe(400);
    expect((await join(S, code)).status).toBe(400); // a senior cannot use their own invite
    const ok = await join(J, code.toLowerCase().replace(/-/g, ' '));
    expect(ok.status).toBe(200);
    expect(ok.data.ownerName).toBe('Senior');
    expect((await join(K, code)).status).toBe(400); // used
    expect((await join(J, code)).status).toBe(409); // already in an office
  });

  it('puts the junior inside the senior’s practice, and keeps everyone else out', async () => {
    expect((await cases(J)).map((c) => c.title)).toEqual(['Senior case']);
    const made = await call(casesRoute.POST, 'POST', '/api/cases', { who: J, body: { title: 'Junior filed this' } });
    expect(made.status).toBe(201);
    expect((await cases(S)).map((c) => c.title).sort()).toEqual(['Junior filed this', 'Senior case']);
    expect(await cases(X)).toEqual([]);
    expect(await cases(K)).toEqual([]);
  });

  it('keeps fees, deleting and office management for the senior', async () => {
    expect((await call(summaryRoute.GET, 'GET', '/api/billing/summary', { who: J })).status).toBe(403);
    expect((await call(entriesRoute.GET, 'GET', '/api/billing/entries', { who: J })).status).toBe(403);
    expect((await call(caseRoute.DELETE, 'DELETE', `/api/cases/${seniorCase}`, { who: J, params: { id: seniorCase } })).status).toBe(403);
    expect((await call(clientRoute.DELETE, 'DELETE', `/api/clients/${client}`, { who: J, params: { id: client } })).status).toBe(403);
    expect((await invite(J)).status).toBe(403);
    expect((await call(summaryRoute.GET, 'GET', '/api/billing/summary', { who: S })).status).toBe(200);
  });

  it('shows a junior their own profile, and edits only that', async () => {
    expect((await call(profileRoute.PATCH, 'PATCH', '/api/profile', { who: J, body: { city: 'Kochi' } })).data.advocate.displayName).toBe('Junior');
    expect((await call(profileRoute.GET, 'GET', '/api/profile', { who: S })).data.advocate.city ?? null).toBeNull();
  });

  it('shows who is in the office, from either side', async () => {
    const mine = (await call(officeRoute.GET, 'GET', '/api/office', { who: S })).data;
    expect(mine.members.map((m: { name: string }) => m.name)).toEqual(['Junior']);
    expect(mine.assignable.map((a: { name: string }) => a.name)).toEqual(['Senior', 'Junior']);
    const theirs = (await call(officeRoute.GET, 'GET', '/api/office', { who: J })).data;
    expect(theirs).toMatchObject({ role: 'junior', owner: { name: 'Senior' }, members: [], invites: [] });
  });

  it('gives hearings to people in the office only', async () => {
    const juniorId = J.id;
    const h = await call(hearingsRoute.POST, 'POST', '/api/hearings', { who: S, body: { caseId: seniorCase, hearingAt: '2026-12-01T05:00:00.000Z', assignedTo: juniorId } });
    expect(h.status).toBe(201);
    const list = (await call(hearingsRoute.GET, 'GET', '/api/hearings', { who: J })).data.hearings;
    expect(list[0]).toMatchObject({ assignedTo: juniorId, assignedName: 'Junior' });
    expect((await call(hearingsRoute.POST, 'POST', '/api/hearings', { who: S, body: { caseId: seniorCase, hearingAt: '2026-12-02T05:00:00.000Z', assignedTo: X.id } })).status).toBe(400);
  });

  it('refuses an expired invite', async () => {
    const r = await invite(S);
    const db = await getDb();
    await db.update(schema.officeInvites).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(schema.officeInvites.advocateId, S.id));
    expect((await join(K, r.data.code)).status).toBe(400);
  });

  it('stops a senior with juniors from joining another office, and counts wrong codes', async () => {
    const other = await invite(X);
    expect((await join(S, other.data.code)).status).toBe(409);
    let last = 0;
    for (let i = 0; i < 11; i++) last = (await join(K, `JR-ZZZZ-${String(1000 + i).slice(0, 4).replace(/[01]/g, '2')}`)).status;
    expect(last).toBe(429);
  });

  it('ends a junior’s access the moment they are removed, and frees their hearings', async () => {
    expect((await call(memberRoute.DELETE, 'DELETE', `/api/office/members/${J.id}`, { who: S, params: { id: J.id } })).status).toBe(200);
    expect(await cases(J)).toEqual([]); // back to their own, empty practice
    expect((await call(summaryRoute.GET, 'GET', '/api/billing/summary', { who: J })).status).toBe(200); // their own books, not the senior's
    const list = (await call(hearingsRoute.GET, 'GET', '/api/hearings', { who: S })).data.hearings;
    expect(list.every((h: { assignedTo: string | null }) => h.assignedTo === null)).toBe(true);
  });

  it('lets a junior leave, and the senior revoke an unused invite', async () => {
    const L = await signIn('Junior3'); // K was rate-limited by the wrong-code test above
    const r = await invite(X);
    expect((await join(L, r.data.code)).status).toBe(200);
    expect((await call(leaveRoute.POST, 'POST', '/api/office/leave', { who: L, body: {} })).status).toBe(200);
    expect((await call(leaveRoute.POST, 'POST', '/api/office/leave', { who: L, body: {} })).status).toBe(400);
    const again = await invite(X);
    const id = (await call(officeRoute.GET, 'GET', '/api/office', { who: X })).data.invites[0].id as string;
    expect((await call(inviteIdRoute.DELETE, 'DELETE', `/api/office/invite/${id}`, { who: X, params: { id } })).status).toBe(200);
    expect((await join(L, again.data.code)).status).toBe(400);
  });
});
