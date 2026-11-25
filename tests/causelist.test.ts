import { beforeAll, describe, expect, it } from 'vitest';
import * as casesRoute from '@/app/api/cases/route';
import * as hearingsRoute from '@/app/api/hearings/route';
import * as importRoute from '@/app/api/causelist/import/route';
import * as confirmRoute from '@/app/api/causelist/confirm/route';
import { istDay, istInstant, itemOrder, matchCase, normaliseCaseNumber, type CaseRef } from '@/lib/causelist';
import { call, setup, signIn, type Who } from './harness';

describe('matching a printed case number to your own cases', () => {
  const cases: CaseRef[] = [
    { id: 'a', title: 'Menon v State', caseNumber: 'W.P.(C) 1234/2024', cnrNumber: 'KLHC010012342024' },
    { id: 'b', title: 'Kumar v State', caseNumber: 'Crl.M.C. No. 55 / 2023', cnrNumber: null },
    { id: 'c', title: 'Other', caseNumber: 'OP(C) 999/2022', cnrNumber: null },
    { id: 'd', title: 'Other bail', caseNumber: 'Bail Appl. 999/2022', cnrNumber: null },
  ];
  it('tidies punctuation, spacing and the word No', () => {
    expect(normaliseCaseNumber('WP(C) No. 1234 / 2024')).toBe('WPC1234/2024');
    expect(normaliseCaseNumber('W.P.(C).1234/2024')).toBe('WPC1234/2024');
  });
  it('matches exactly by case number or by CNR', () => {
    expect(matchCase({ caseNumber: 'WP(C) No. 1234/2024' }, cases)).toMatchObject({ caseId: 'a', confidence: 'exact' });
    expect(matchCase({ caseNumber: 'CRL.M.C. 55/2023' }, cases)).toMatchObject({ caseId: 'b', confidence: 'exact' });
    expect(matchCase({ caseNumber: 'something else', cnr: 'KLHC 0100 1234 2024' }, cases)).toMatchObject({ caseId: 'a', confidence: 'exact' });
  });
  it('asks you to check when only the number and year agree, and never when two cases share them', () => {
    expect(matchCase({ caseNumber: 'WA 1234/2024' }, cases)).toMatchObject({ caseId: 'a', confidence: 'check' });
    expect(matchCase({ caseNumber: 'RP 999/2022' }, cases)).toMatchObject({ caseId: null, confidence: 'none' }); // c and d both share 999/2022
  });
  it('says none for a case that is not yours', () => {
    expect(matchCase({ caseNumber: 'WP(C) 7/2020' }, cases)).toMatchObject({ caseId: null, confidence: 'none' });
    expect(matchCase({ caseNumber: '' }, cases).confidence).toBe('none');
  });
  it('uses India time for the day and sorts item numbers like a printed list', () => {
    expect(istInstant('2026-11-25').toISOString()).toBe('2026-11-25T05:00:00.000Z');
    expect(istDay('2026-11-25').from.toISOString()).toBe('2026-11-24T18:30:00.000Z');
    expect(['13', '12A', '', '2', '12'].sort((x, y) => itemOrder(x) - itemOrder(y))).toEqual(['2', '12', '12A', '13', '']);
  });
});

describe('cause-list import and confirm', () => {
  let A: Who;
  let B: Who;
  const ok = { consent: true, sendCaseDetails: false };
  const day = '2026-11-25';
  const makeCase = async (who: Who, title: string, caseNumber: string) =>
    (await call(casesRoute.POST, 'POST', '/api/cases', { who, body: { title, caseNumber } })).data.case.id as string;
  beforeAll(async () => { await setup(); A = await signIn('Cause'); B = await signIn('Other'); });

  it('needs consent and a date, and a real signed-in advocate', async () => {
    const text = 'Item 12 WP(C) 1234/2024 for arguments, Court Hall 3';
    expect((await call(importRoute.POST, 'POST', '/api/causelist/import', { who: A, body: { text, hearingDate: day } })).status).toBe(400);
    expect((await call(importRoute.POST, 'POST', '/api/causelist/import', { who: A, body: { text, hearingDate: 'tomorrow', ...ok } })).status).toBe(400);
    expect((await call(importRoute.POST, 'POST', '/api/causelist/import', { body: { text, hearingDate: day, ...ok } })).status).toBe(401);
  });

  it('matches rows to your cases, saves nothing, and flags what is not yours', async () => {
    const mine = await makeCase(A, 'Menon v State', 'WP(C) 1234/2024');
    await makeCase(B, 'Someone elses case', 'CRL.M.C. 55/2023'); // another advocate's case must never match
    const r = await call(importRoute.POST, 'POST', '/api/causelist/import', { who: A, body: { text: 'pasted cause list, three items, long enough', hearingDate: day, ...ok } });
    expect(r.status).toBe(200);
    expect(r.data.rows).toHaveLength(3);
    expect(r.data.rows[0]).toMatchObject({ itemNumber: '12', caseId: mine, confidence: 'exact', alreadyListed: false });
    expect(r.data.rows[1]).toMatchObject({ itemNumber: '27', caseId: null, confidence: 'none' });
    expect(r.data.unmatched).toBe(2);
    const saved = await call(hearingsRoute.GET, 'GET', '/api/hearings', { who: A });
    expect(saved.data.hearings).toHaveLength(0);
  });

  it('adds hearings with item number and bench, updates instead of duplicating, and refuses another advocate’s case', async () => {
    const mine = (await call(casesRoute.GET, 'GET', '/api/cases', { who: A })).data.cases[0].id as string;
    const body = { hearingDate: day, rows: [{ caseId: mine, itemNumber: '12', bench: 'Justice Nair', courtroom: 'Court Hall 3', purpose: 'For arguments' }] };
    expect((await call(confirmRoute.POST, 'POST', '/api/causelist/confirm', { who: A, body })).data).toEqual({ created: 1, updated: 0 });
    const again = await call(confirmRoute.POST, 'POST', '/api/causelist/confirm', { who: A, body: { ...body, rows: [{ ...body.rows[0], itemNumber: '9' }] } });
    expect(again.data).toEqual({ created: 0, updated: 1 });
    const list = (await call(hearingsRoute.GET, 'GET', '/api/hearings', { who: A })).data.hearings;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ itemNumber: '9', bench: 'Justice Nair', courtroom: 'Court Hall 3', purpose: 'For arguments' });
    expect(new Date(list[0].hearingAt).toISOString()).toBe('2026-11-25T05:00:00.000Z');
    const reimport = await call(importRoute.POST, 'POST', '/api/causelist/import', { who: A, body: { text: 'pasted cause list, three items, long enough', hearingDate: day, ...ok } });
    expect(reimport.data.rows[0].alreadyListed).toBe(true);
    const theirs = (await call(casesRoute.GET, 'GET', '/api/cases', { who: B })).data.cases[0].id as string;
    // One foreign case rejects the whole request and saves none of it, even the rows that are fine.
    const mixed = await call(confirmRoute.POST, 'POST', '/api/causelist/confirm', { who: A, body: { hearingDate: '2026-11-26', rows: [{ caseId: mine, itemNumber: '1' }, { caseId: theirs }] } });
    expect(mixed.status).toBe(400);
    expect((await call(hearingsRoute.GET, 'GET', '/api/hearings', { who: A })).data.hearings).toHaveLength(1);
  });
});
