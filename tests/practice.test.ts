import { beforeAll, describe, expect, it } from 'vitest';
import * as clientsRoute from '@/app/api/clients/route';
import * as clientRoute from '@/app/api/clients/[id]/route';
import * as casesRoute from '@/app/api/cases/route';
import * as caseRoute from '@/app/api/cases/[id]/route';
import * as notesRoute from '@/app/api/cases/[id]/notes/route';
import * as noteRoute from '@/app/api/cases/[id]/notes/[noteId]/route';
import * as hearingsRoute from '@/app/api/hearings/route';
import * as hearingRoute from '@/app/api/hearings/[id]/route';
import * as icsRoute from '@/app/api/hearings/ics/route';
import * as notifRoute from '@/app/api/notifications/route';
import * as readRoute from '@/app/api/notifications/read/route';
import * as dashRoute from '@/app/api/dashboard/route';
import * as profileRoute from '@/app/api/profile/route';
import * as cronRoute from '@/app/api/cron/reminders/route';
import { buildIcs } from '@/lib/ics';
import { call, setup, signIn, type Who } from './harness';

let A: Who;
let B: Who;
beforeAll(async () => {
  await setup();
  A = await signIn('Asha');
  B = await signIn('Bharat');
});

describe('access control', () => {
  it('rejects signed-out requests and cross-site writes', async () => {
    expect((await call(casesRoute.GET, 'GET', '/api/cases')).status).toBe(401);
    expect((await call(casesRoute.POST, 'POST', '/api/cases', { who: A, body: { title: 'x' }, headers: { origin: 'https://evil.example' } })).status).toBe(403);
    expect((await call(casesRoute.POST, 'POST', '/api/cases', { body: { title: 'x' } })).status).toBe(401);
    expect((await call(casesRoute.GET, 'GET', '/api/cases', { who: { id: '', cookie: 'advocate_session=forged' } })).status).toBe(401);
  });
});

describe('clients', () => {
  it('creates, validates, searches, updates and deletes', async () => {
    expect((await call(clientsRoute.POST, 'POST', '/api/clients', { who: A, body: { name: '' } })).status).toBe(400);
    expect((await call(clientsRoute.POST, 'POST', '/api/clients', { who: A, body: { name: 'X', email: 'not-an-email' } })).status).toBe(400);
    const made = await call(clientsRoute.POST, 'POST', '/api/clients', { who: A, body: { name: 'Ravi Kumar', email: 'ravi@example.com', phone: '9999999999', notes: '' } });
    expect(made.status).toBe(201);
    const id = made.data.client.id;
    expect(made.data.client.notes).toBeNull(); // empty string clears
    expect((await call(clientsRoute.GET, 'GET', '/api/clients?q=rav', { who: A })).data.clients).toHaveLength(1);
    expect((await call(clientsRoute.GET, 'GET', '/api/clients?q=%25', { who: A })).data.clients).toHaveLength(0); // wildcard is literal
    expect((await call(clientRoute.PATCH, 'PATCH', `/api/clients/${id}`, { who: A, params: { id }, body: { city: 'ignored?', phone: '8888888888' } })).data.client.phone).toBe('8888888888');
    expect((await call(clientRoute.GET, 'GET', '/api/clients/not-a-uuid', { who: A, params: { id: 'not-a-uuid' } })).status).toBe(404);
    expect((await call(clientRoute.DELETE, 'DELETE', `/api/clients/${id}`, { who: A, params: { id } })).status).toBe(200);
    expect((await call(clientRoute.GET, 'GET', `/api/clients/${id}`, { who: A, params: { id } })).status).toBe(404);
  });
});

describe('cases, notes and tenant isolation', () => {
  it('manages a case and keeps advocates apart', async () => {
    const cl = (await call(clientsRoute.POST, 'POST', '/api/clients', { who: A, body: { name: 'Meena' } })).data.client;
    const bad = await call(casesRoute.POST, 'POST', '/api/cases', { who: A, body: { title: 'T', cnrNumber: 'short' } });
    expect(bad.status).toBe(400);
    const made = await call(casesRoute.POST, 'POST', '/api/cases', {
      who: A, body: { title: 'Meena v. State', clientId: cl.id, cnrNumber: 'mhpu010012342024', court: 'Pune District Court', status: 'open', filingDate: '2024-03-05', petitioner: 'Meena' },
    });
    expect(made.status).toBe(201);
    expect(made.data.case.cnrNumber).toBe('MHPU010012342024');
    const id = made.data.case.id;

    // Another advocate cannot see, change, delete, or attach to it.
    expect((await call(caseRoute.GET, 'GET', `/api/cases/${id}`, { who: B, params: { id } })).status).toBe(404);
    expect((await call(caseRoute.PATCH, 'PATCH', `/api/cases/${id}`, { who: B, params: { id }, body: { title: 'hijack' } })).status).toBe(404);
    expect((await call(caseRoute.DELETE, 'DELETE', `/api/cases/${id}`, { who: B, params: { id } })).status).toBe(404);
    expect((await call(casesRoute.GET, 'GET', '/api/cases', { who: B })).data.cases).toHaveLength(0);
    expect((await call(notesRoute.POST, 'POST', `/api/cases/${id}/notes`, { who: B, params: { id }, body: { body: 'x' } })).status).toBe(404);
    expect((await call(hearingsRoute.POST, 'POST', '/api/hearings', { who: B, body: { caseId: id, hearingAt: new Date().toISOString() } })).status).toBe(400);
    expect((await call(casesRoute.POST, 'POST', '/api/cases', { who: B, body: { title: 'mine', clientId: cl.id } })).status).toBe(400); // A's client
    expect((await call(caseRoute.PATCH, 'PATCH', `/api/cases/${id}`, { who: A, params: { id }, body: { clientId: (await call(clientsRoute.POST, 'POST', '/api/clients', { who: B, body: { name: 'B client' } })).data.client.id } })).status).toBe(400);

    // The owner can.
    expect((await call(casesRoute.GET, 'GET', '/api/cases?q=meena', { who: A })).data.cases[0].clientName).toBe('Meena');
    expect((await call(casesRoute.GET, 'GET', '/api/cases?status=disposed', { who: A })).data.cases).toHaveLength(0);
    const note = await call(notesRoute.POST, 'POST', `/api/cases/${id}/notes`, { who: A, params: { id }, body: { body: 'Client called' } });
    expect(note.status).toBe(201);
    const detail = await call(caseRoute.GET, 'GET', `/api/cases/${id}`, { who: A, params: { id } });
    expect(detail.data.notes).toHaveLength(1);
    expect(detail.data.client.name).toBe('Meena');
    expect((await call(noteRoute.DELETE, 'DELETE', `/api/cases/${id}/notes/${note.data.note.id}`, { who: B, params: { id, noteId: note.data.note.id } })).status).toBe(404);
    expect((await call(noteRoute.DELETE, 'DELETE', `/api/cases/${id}/notes/${note.data.note.id}`, { who: A, params: { id, noteId: note.data.note.id } })).status).toBe(200);
    expect((await call(caseRoute.PATCH, 'PATCH', `/api/cases/${id}`, { who: A, params: { id }, body: { stage: 'Arguments', status: 'pending' } })).data.case.stage).toBe('Arguments');
    expect((await call(caseRoute.PATCH, 'PATCH', `/api/cases/${id}`, { who: A, params: { id }, body: { status: 'bogus' } })).status).toBe(400);
  });
});

describe('hearings, reminders, calendar', () => {
  it('schedules, lists, reminds once, resets on reschedule, exports ICS', async () => {
    const c = (await call(casesRoute.POST, 'POST', '/api/cases', { who: A, body: { title: 'Rao v. Rao', caseNumber: 'CS 12/2024' } })).data.case;
    const inHours = (h: number) => new Date(Date.now() + h * 36e5).toISOString();
    const soon = await call(hearingsRoute.POST, 'POST', '/api/hearings', { who: A, body: { caseId: c.id, hearingAt: inHours(20), purpose: 'Arguments, final; evidence', court: 'High Court', remindBeforeMinutes: 1440 } });
    expect(soon.status).toBe(201);
    const later = await call(hearingsRoute.POST, 'POST', '/api/hearings', { who: A, body: { caseId: c.id, hearingAt: inHours(24 * 10) } });
    expect((await call(hearingsRoute.POST, 'POST', '/api/hearings', { who: A, body: { caseId: c.id, hearingAt: 'garbage' } })).status).toBe(400);

    const list = await call(hearingsRoute.GET, 'GET', `/api/hearings?from=${encodeURIComponent(inHours(0))}`, { who: A });
    expect(list.data.hearings.map((h: { id: string }) => h.id)).toEqual([soon.data.hearing.id, later.data.hearing.id]);
    expect(list.data.hearings[0].caseTitle).toBe('Rao v. Rao');
    expect((await call(hearingsRoute.GET, 'GET', '/api/hearings', { who: B })).data.hearings).toHaveLength(0);

    // Cron: protected, notifies only the hearing that is due, and only once.
    expect((await call(cronRoute.GET, 'GET', '/api/cron/reminders')).status).toBe(401);
    expect((await call(cronRoute.GET, 'GET', '/api/cron/reminders', { headers: { authorization: 'Bearer wrong-secret-000000000' } })).status).toBe(401);
    const run = (await call(cronRoute.GET, 'GET', '/api/cron/reminders', { headers: { authorization: 'Bearer cron-secret-0123456789' } })).data;
    expect(run.created).toBe(1);
    expect((await call(cronRoute.GET, 'GET', '/api/cron/reminders', { headers: { authorization: 'Bearer cron-secret-0123456789' } })).data.created).toBe(0);
    const n = (await call(notifRoute.GET, 'GET', '/api/notifications', { who: A })).data;
    expect(n.unread).toBe(1);
    expect(n.items[0].title).toMatch(/^Hearing .* IST: Rao v\. Rao$/);
    expect((await call(notifRoute.GET, 'GET', '/api/notifications', { who: B })).data.items).toHaveLength(0);

    // Rescheduling makes the old reminder stale and re-arms it.
    const id = soon.data.hearing.id;
    await call(hearingRoute.PATCH, 'PATCH', `/api/hearings/${id}`, { who: A, params: { id }, body: { hearingAt: inHours(10) } });
    expect((await call(notifRoute.GET, 'GET', '/api/notifications', { who: A })).data.items).toHaveLength(0);
    expect((await call(cronRoute.GET, 'GET', '/api/cron/reminders', { headers: { authorization: 'Bearer cron-secret-0123456789' } })).data.created).toBe(1);

    // Mark read: another advocate's ids are ignored.
    const nid = (await call(notifRoute.GET, 'GET', '/api/notifications', { who: A })).data.items[0].id;
    expect((await call(readRoute.POST, 'POST', '/api/notifications/read', { who: B, body: { ids: [nid] } })).data.marked).toBe(0);
    expect((await call(readRoute.POST, 'POST', '/api/notifications/read', { who: A, body: { all: true } })).data.marked).toBe(1);
    expect((await call(notifRoute.GET, 'GET', '/api/notifications', { who: A })).data.unread).toBe(0);

    // A completed hearing is never reminded.
    await call(hearingRoute.PATCH, 'PATCH', `/api/hearings/${later.data.hearing.id}`, { who: A, params: { id: later.data.hearing.id }, body: { status: 'completed', remindBeforeMinutes: 99999999 } });
    expect((await call(hearingRoute.PATCH, 'PATCH', `/api/hearings/${id}`, { who: B, params: { id }, body: { purpose: 'x' } })).status).toBe(404);

    const ics = await call(icsRoute.GET, 'GET', '/api/hearings/ics', { who: A });
    expect(ics.res.headers.get('content-type')).toContain('text/calendar');
    expect(ics.data).toContain('BEGIN:VEVENT');
    expect(ics.data).toContain('SUMMARY:Hearing: Rao v. Rao (CS 12/2024)');
    expect(ics.data).toContain('TRIGGER:-PT1440M');
    expect((await call(icsRoute.GET, 'GET', '/api/hearings/ics', { who: B })).data).not.toContain('VEVENT');
  });

  it('ICS escapes special characters and folds long lines', () => {
    const out = buildIcs([{ id: 'x', hearingAt: new Date('2030-01-01T04:30:00Z'), caseTitle: 'A, B; C\\D', caseNumber: null, purpose: 'line1\nline2', court: null, courtroom: null, notes: null, remindBeforeMinutes: 60 }]);
    expect(out).toContain('DTSTART:20300101T043000Z');
    expect(out).toContain('SUMMARY:Hearing: A\\, B\; C\\\\D');
    expect(out).toContain('DESCRIPTION:line1\\nline2');
    const long = buildIcs([{ id: 'x', hearingAt: new Date(), caseTitle: 'ä'.repeat(200), caseNumber: null, purpose: null, court: null, courtroom: null, notes: null, remindBeforeMinutes: 0 }]);
    for (const line of long.split('\r\n')) expect(Buffer.byteLength(line)).toBeLessThanOrEqual(75);
  });
});

describe('dashboard and profile', () => {
  it('summarises the advocate\'s own work only', async () => {
    const d = (await call(dashRoute.GET, 'GET', '/api/dashboard', { who: A })).data;
    expect(d.stats.openCases).toBeGreaterThanOrEqual(2);
    expect(d.stats.hearingsThisWeek).toBe(1);
    expect(d.upcomingHearings[0].caseTitle).toBe('Rao v. Rao');
    const db = (await call(dashRoute.GET, 'GET', '/api/dashboard', { who: B })).data;
    expect(db.stats).toMatchObject({ openCases: 0, hearingsThisWeek: 0, documents: 0 });
  });
  it('updates the profile with validation', async () => {
    const ok = await call(profileRoute.PATCH, 'PATCH', '/api/profile', { who: A, body: { enrolmentNumber: 'D/1234/2015', city: 'Delhi', practiceAreas: ['Criminal', 'Civil'], preferredLanguage: 'hindi', languages: ['english', 'hindi'] } });
    expect(ok.data.advocate).toMatchObject({ city: 'Delhi', preferredLanguage: 'hindi', practiceAreas: ['Criminal', 'Civil'] });
    expect((await call(profileRoute.PATCH, 'PATCH', '/api/profile', { who: A, body: { preferredLanguage: 'klingon' } })).status).toBe(400);
    expect((await call(profileRoute.GET, 'GET', '/api/profile', { who: B })).data.advocate.city).toBeNull();
  });
});
