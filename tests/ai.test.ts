import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import * as chat from '@/app/api/chat/route';
import * as convs from '@/app/api/conversations/route';
import * as conv from '@/app/api/conversations/[id]/route';
import * as research from '@/app/api/research/route';
import * as analysis from '@/app/api/analysis/route';
import * as translate from '@/app/api/translate/route';
import * as drafts from '@/app/api/drafts/route';
import * as draft from '@/app/api/drafts/[id]/route';
import * as gen from '@/app/api/drafts/generate/route';
import * as edit from '@/app/api/drafts/[id]/edit/route';
import * as restore from '@/app/api/drafts/[id]/restore/route';
import * as docs from '@/app/api/documents/route';
import * as doc from '@/app/api/documents/[id]/route';
import * as finalize from '@/app/api/documents/[id]/finalize/route';
import * as content from '@/app/api/documents/[id]/content/route';
import * as ocr from '@/app/api/documents/[id]/ocr/route';
import * as cases from '@/app/api/cases/route';
import * as analyses from '@/app/api/analyses/route';
import * as aiClient from '@/lib/ai/client';
import { getDb } from '@/lib/db';
import { aiUsage } from '@/lib/db/schema';
import { APP, call, setup, signIn, type Who } from './harness';
import { makePdf, makeScannedPdf } from './helpers';

let A: Who;
let B: Who;
beforeAll(async () => {
  await setup();
  process.env.STORAGE_DRIVER = 'local';
  process.env.LOCAL_STORAGE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'adv-files-'));
  A = await signIn('Asha');
  B = await signIn('Bharat');
});

/** Reads a server-sent-events response into [{event, data}]. */
async function sse(res: Response) {
  const text = await res.text();
  return text.trim().split('\n\n').map((block) => {
    const event = /^event: (.*)$/m.exec(block)![1];
    return { event, data: JSON.parse(/^data: (.*)$/m.exec(block)![1]) };
  });
}

describe('chat', () => {
  let conversationId: string;
  it('streams an answer, removes unverified citations, flags case names, and saves the conversation', async () => {
    const r = await call(chat.POST, 'POST', '/api/chat', { who: A, body: { consent: true, message: 'What is the basic structure doctrine?' }, raw: true });
    expect(r.res.headers.get('content-type')).toContain('text/event-stream');
    const events = await sse(r.res);
    expect(events[0].event).toBe('meta');
    conversationId = events[0].data.conversationId;
    const deltas = events.filter((e) => e.event === 'delta');
    expect(deltas.length).toBeGreaterThanOrEqual(2); // released a line at a time
    // Strict: the invented citation is never sent to the browser, not even while streaming.
    expect(deltas.map((d) => d.data.text).join('')).not.toContain('AIR 1973');
    const done = events.at(-1)!;
    expect(done.event).toBe('done');
    expect(done.data.text).not.toContain('AIR 1973');
    expect(done.data.text).toContain('[citation withheld');
    expect(done.data.text).toContain('Kesavananda Bharati v. State of Kerala ⚠️[unverified]');
    expect(JSON.stringify(done.data.flags)).not.toContain('AIR 1973'); // the flag list does not bring it back
    expect(done.data.flags.map((f: { kind: string }) => f.kind).sort()).toEqual(['case_name', 'citation']);

    const saved = await call(conv.GET, 'GET', `/api/conversations/${conversationId}`, { who: A, params: { id: conversationId } });
    expect(saved.data.messages.map((m: { role: string }) => m.role)).toEqual(['user', 'assistant']);
    expect(saved.data.messages[1].flags).toHaveLength(2);
  });

  it('does not flag an authority the advocate typed themselves, and continues the conversation', async () => {
    const r = await call(chat.POST, 'POST', '/api/chat', {
      who: A, raw: true,
      body: { consent: true, conversationId, message: 'I rely on Kesavananda Bharati v. State of Kerala, AIR 1973 SC 1461. Explain.' },
    });
    const done = (await sse(r.res)).at(-1)!;
    expect(done.data.flags).toEqual([]);
    expect(done.data.text).not.toContain('unverified');
    expect((await call(convs.GET, 'GET', '/api/conversations', { who: A })).data.conversations).toHaveLength(1);
  });

  it('keeps conversations private and validates input', async () => {
    expect((await call(conv.GET, 'GET', `/api/conversations/${conversationId}`, { who: B, params: { id: conversationId } })).status).toBe(404);
    expect((await call(chat.POST, 'POST', '/api/chat', { who: B, body: { consent: true, conversationId, message: 'hi' } })).status).toBe(404);
    expect((await call(chat.POST, 'POST', '/api/chat', { who: A, body: { message: '' } })).status).toBe(400);
    expect((await call(chat.POST, 'POST', '/api/chat', { body: { consent: true, message: 'x' } })).status).toBe(401);
    expect((await call(conv.DELETE, 'DELETE', `/api/conversations/${conversationId}`, { who: B, params: { id: conversationId } })).status).toBe(404);
    expect((await call(conv.DELETE, 'DELETE', `/api/conversations/${conversationId}`, { who: A, params: { id: conversationId } })).status).toBe(200);
  });

  it('uses the case as context and enforces the daily limit', async () => {
    const c = (await call(cases.POST, 'POST', '/api/cases', { who: A, body: { title: 'Context case' } })).data.case;
    const ok = await call(chat.POST, 'POST', '/api/chat', { who: A, raw: true, body: { consent: true, message: 'Summarise my case', caseId: c.id } });
    expect((await sse(ok.res)).at(-1)!.event).toBe('done');
    expect((await call(chat.POST, 'POST', '/api/chat', { who: B, body: { consent: true, message: 'x', caseId: c.id } })).status).toBe(400); // not B's case
    process.env.AI_DAILY_LIMIT = '1';
    const limited = await call(chat.POST, 'POST', '/api/chat', { who: A, body: { consent: true, message: 'again' } });
    expect(limited.status).toBe(429);
    expect(limited.data.code).toBe('quota');
    delete process.env.AI_DAILY_LIMIT;
  });
});

describe('research', () => {
  it('downgrades an authority claimed from "provided sources" when it is not in them', async () => {
    const r = await call(research.POST, 'POST', '/api/research', { who: A, body: { consent: true, question: 'Is the basic structure doctrine part of Indian law?' } });
    expect(r.status).toBe(200);
    const k = r.data.result.authorities.find((a: { name: string }) => a.name.startsWith('Kesavananda'));
    expect(k).toMatchObject({ basis: 'model_memory', verified: false, downgraded: true });
    expect(JSON.stringify(r.data)).not.toContain('AIR 1973'); // neither the memo nor its flags show the removed citation
    expect(r.data.flags.some((f: { text: string }) => f.text.includes('Kesavananda'))).toBe(true);
  });
  it('believes it when the advocate\'s materials contain it', async () => {
    const r = await call(research.POST, 'POST', '/api/research', { who: A, body: { consent: true, question: 'Basic structure?', materials: 'Extract: Kesavananda Bharati v. State of Kerala was decided by 13 judges.' } });
    expect(r.data.result.authorities[0]).toMatchObject({ basis: 'provided_source', verified: true, downgraded: false });
    expect(r.data.result.authorities[1]).toMatchObject({ verified: false }); // statute from memory is never "verified"
  });
});

describe('documents: upload, scan detection, analysis', () => {
  const upload = async (who: Who, bytes: Uint8Array, name = 'order.pdf') => {
    const init = await call(docs.POST, 'POST', '/api/documents', { who, body: { fileName: name, sizeBytes: bytes.length } });
    expect(init.status).toBe(201);
    const id = init.data.document.id;
    expect(init.data.upload.url).toBe(`/api/documents/${id}/content`);
    const put = new Request(APP + init.data.upload.url, { method: 'PUT', headers: { host: 'localhost:3999', origin: APP, cookie: who.cookie }, body: bytes as BodyInit });
    expect((await content.PUT(put, { params: Promise.resolve({ id }) })).status).toBe(200);
    return { id, finalize: () => call(finalize.POST, 'POST', `/api/documents/${id}/finalize`, { who, params: { id } }) };
  };

  it('accepts a real PDF with text and summarises it from the text layer', async () => {
    const lines = Array.from({ length: 30 }, (_, i) => `Paragraph ${i + 1}: The petitioner submits that the impugned order dated 5 March 2024 is arbitrary and must be set aside.`);
    const u = await upload(A, makePdf(lines));
    const f = await u.finalize();
    expect(f.status).toBe(200);
    expect(f.data.document).toMatchObject({ pageCount: 1, scanned: false });
    const s = await call(analysis.POST, 'POST', '/api/analysis', { who: A, body: { consent: true, kind: 'summary', documentId: u.id } });
    expect(s.status).toBe(200);
    expect(s.data.readAs).toBe('text');
    const d = await call(doc.GET, 'GET', `/api/documents/${u.id}`, { who: A, params: { id: u.id } });
    expect(d.data.document.textPreview).toContain('impugned order');
    expect(d.data.document).not.toHaveProperty('storagePath');
    expect(d.data.analyses).toHaveLength(1);
    // Another advocate can neither see nor analyse it.
    expect((await call(doc.GET, 'GET', `/api/documents/${u.id}`, { who: B, params: { id: u.id } })).status).toBe(404);
    expect((await call(analysis.POST, 'POST', '/api/analysis', { who: B, body: { consent: true, kind: 'summary', documentId: u.id } })).status).toBe(404);
    expect((await call(doc.DELETE, 'DELETE', `/api/documents/${u.id}`, { who: A, params: { id: u.id } })).status).toBe(200);
    expect((await call(doc.GET, 'GET', `/api/documents/${u.id}`, { who: A, params: { id: u.id } })).status).toBe(404);
  });

  it('reads a scanned PDF with OCR first, then analyses the OCR text', async () => {
    const u = await upload(A, await makeScannedPdf([['IN THE HIGH COURT OF DELHI', 'The petition is dismissed.'], ['Costs of Rupees 5000 are imposed.']]));
    const f = await u.finalize();
    expect(f.data.document).toMatchObject({ scanned: true, needsOcr: true, pageCount: 2 });
    // Analysis is refused until the pages have been read.
    const early = await call(analysis.POST, 'POST', '/api/analysis', { who: A, body: { consent: true, kind: 'judgment', documentId: u.id } });
    expect(early.status).toBe(409);
    expect(early.data.code).toBe('needs_ocr');
    // Another advocate cannot OCR (or even see) it.
    expect((await call(ocr.POST, 'POST', `/api/documents/${u.id}/ocr`, { who: B, params: { id: u.id }, body: {} })).status).toBe(404);
    // Read in batches of one page: resumable progress.
    const p1 = await call(ocr.POST, 'POST', `/api/documents/${u.id}/ocr`, { who: A, params: { id: u.id }, body: { batch: 1 } });
    expect(p1.data).toMatchObject({ done: false, pagesDone: 1, pageCount: 2 });
    const p2 = await call(ocr.POST, 'POST', `/api/documents/${u.id}/ocr`, { who: A, params: { id: u.id }, body: { batch: 1 } });
    expect(p2.data).toMatchObject({ done: true, pagesDone: 2 });
    expect(p2.data.confidence).toBeGreaterThan(50);
    const again = await call(ocr.POST, 'POST', `/api/documents/${u.id}/ocr`, { who: A, params: { id: u.id }, body: {} });
    expect(again.data.done).toBe(true); // nothing re-read
    const d = await call(doc.GET, 'GET', `/api/documents/${u.id}`, { who: A, params: { id: u.id } });
    expect(d.data.document.textPreview.toUpperCase()).toContain('HIGH COURT OF DELHI');
    expect(d.data.document.textPreview).toContain('--- page 2 ---');
    const s = await call(analysis.POST, 'POST', '/api/analysis', { who: A, body: { consent: true, kind: 'judgment', documentId: u.id } });
    expect(s.status).toBe(200);
    expect(s.data.readAs).toBe('ocr');
    expect(s.data.ocrConfidence).toBeGreaterThan(50);
  }, 180_000);

  it('does not OCR a PDF that already has text, and enforces the page limit', async () => {
    const text = await upload(A, makePdf(Array.from({ length: 30 }, (_, i) => `Paragraph ${i + 1} of an ordinary text PDF with plenty of words in it.`)));
    expect((await text.finalize()).data.document.needsOcr).toBe(false);
    expect((await call(ocr.POST, 'POST', `/api/documents/${text.id}/ocr`, { who: A, params: { id: text.id }, body: {} })).status).toBe(400);
    process.env.OCR_MAX_PAGES = '1';
    const big = await upload(A, await makeScannedPdf([['PAGE ONE'], ['PAGE TWO']]));
    await big.finalize();
    const r = await call(ocr.POST, 'POST', `/api/documents/${big.id}/ocr`, { who: A, params: { id: big.id }, body: {} });
    expect(r.status).toBe(413);
    expect(r.data.error).toMatch(/limited to 1 pages/);
    delete process.env.OCR_MAX_PAGES;
  }, 120_000);

  it('rejects non-PDFs (by content, not name), wrong extensions, and unfinished uploads', async () => {
    const fake = await upload(A, new TextEncoder().encode('<html>not a pdf</html>'));
    expect((await fake.finalize()).status).toBe(400);
    expect((await call(docs.POST, 'POST', '/api/documents', { who: A, body: { fileName: 'x.exe', sizeBytes: 10 } })).status).toBe(400);
    expect((await call(docs.POST, 'POST', '/api/documents', { who: A, body: { fileName: 'x.pdf', sizeBytes: 26 * 1024 * 1024 } })).status).toBe(400);
    const pending = await call(docs.POST, 'POST', '/api/documents', { who: A, body: { fileName: 'y.pdf', sizeBytes: 10 } });
    const id = pending.data.document.id;
    expect((await call(finalize.POST, 'POST', `/api/documents/${id}/finalize`, { who: A, params: { id } })).status).toBe(400);
    expect((await call(analysis.POST, 'POST', '/api/analysis', { who: A, body: { consent: true, kind: 'summary', documentId: id } })).status).toBe(400);
  });
});

describe('contract and judgment analysis verify against the source text', () => {
  it('marks quotes and cited cases that are not in the document', async () => {
    const contract = 'ARTICLE 7. The Seller shall indemnify without limit the Buyer against all losses. Governing law: India.';
    const c = await call(analysis.POST, 'POST', '/api/analysis', { who: A, body: { consent: true, kind: 'contract', text: contract, side: 'Seller' } });
    expect(c.data.result.risks.map((r: { quote_verified: boolean }) => r.quote_verified)).toEqual([true, false]);
    expect(JSON.stringify(c.data)).not.toContain('AIR 1999 SC 999'); // not in the contract text

    const judgment = 'The Court held that justice delayed is justice denied. Reliance was placed on Real v. Cited (2001) 1 SCC 1.';
    const j = await call(analysis.POST, 'POST', '/api/analysis', { who: A, body: { consent: true, kind: 'judgment', text: judgment } });
    expect(j.data.result.key_quotes.map((q: { verified: boolean }) => q.verified)).toEqual([true, false]);
    expect(j.data.result.cases_cited_in_judgment.map((x: { verified: boolean }) => x.verified)).toEqual([true, false]);
    // The cited-case citation that is NOT in the judgment is removed; the one that is stays.
    expect(JSON.stringify(j.data)).not.toContain('AIR 1999 SC 999');
    expect(JSON.stringify(j.data.result)).toContain('(2001) 1 SCC 1');
    expect((await call(analysis.POST, 'POST', '/api/analysis', { who: A, body: { consent: true, kind: 'contract' } })).status).toBe(400);
    expect((await call(analyses.GET, 'GET', '/api/analyses?kind=contract', { who: A })).data.analyses).toHaveLength(1);
    expect((await call(analyses.GET, 'GET', '/api/analyses?kind=contract', { who: B })).data.analyses).toHaveLength(0);
  });
});

describe('drafting and editing', () => {
  it('generates, edits with version history, restores, and protects other advocates', async () => {
    const g = await call(gen.POST, 'POST', '/api/drafts/generate', { who: A, body: { consent: true, docType: 'legal_notice', instructions: 'Client Ravi wants notice to tenant for unpaid rent of 3 months.' } });
    expect(g.status).toBe(201);
    const id = g.data.draft.id;
    expect(g.data.draft.title).toBe('Legal notice');
    expect(g.data.draft.content).toContain('[●]'); // placeholders for unknown facts
    expect(g.data.flags).toEqual([]); // Indian Contract Act, 1872 is a known Act

    const e = await call(edit.POST, 'POST', `/api/drafts/${id}/edit`, { who: A, params: { id }, body: { consent: true, instruction: 'Make it more formal' } });
    expect(e.data.draft.content).toContain('(revised by mock)');
    const v = (await call(draft.GET, 'GET', `/api/drafts/${id}`, { who: A, params: { id } })).data;
    expect(v.versions).toHaveLength(2); // creation + pre-edit snapshot
    const original = v.versions.at(-1);
    const back = await call(restore.POST, 'POST', `/api/drafts/${id}/restore`, { who: A, params: { id }, body: { versionId: original.id } });
    expect(back.data.draft.content).not.toContain('(revised by mock)');

    expect((await call(edit.POST, 'POST', `/api/drafts/${id}/edit`, { who: A, params: { id }, body: { consent: true, instruction: 'x y z', passage: 'not in the draft' } })).status).toBe(400);
    expect((await call(draft.GET, 'GET', `/api/drafts/${id}`, { who: B, params: { id } })).status).toBe(404);
    expect((await call(edit.POST, 'POST', `/api/drafts/${id}/edit`, { who: B, params: { id }, body: { consent: true, instruction: 'Make it formal' } })).status).toBe(404);
    expect((await call(restore.POST, 'POST', `/api/drafts/${id}/restore`, { who: B, params: { id }, body: { versionId: original.id } })).status).toBe(404);

    const manual = await call(drafts.POST, 'POST', '/api/drafts', { who: A, body: { title: 'Mine', content: 'v1' } });
    const mid = manual.data.draft.id;
    await call(draft.PATCH, 'PATCH', `/api/drafts/${mid}`, { who: A, params: { id: mid }, body: { content: 'v2' } });
    expect((await call(draft.GET, 'GET', `/api/drafts/${mid}`, { who: A, params: { id: mid } })).data.versions).toHaveLength(2);
    expect((await call(drafts.GET, 'GET', '/api/drafts', { who: B })).data.drafts).toHaveLength(0);
    expect((await call(draft.DELETE, 'DELETE', `/api/drafts/${mid}`, { who: A, params: { id: mid } })).status).toBe(200);
  });
});

describe('translation', () => {
  it('translates, warns it is uncertified, and validates languages', async () => {
    const t = await call(translate.POST, 'POST', '/api/translate', { who: A, body: { consent: true, text: 'The petition is dismissed.', from: 'english', to: 'hindi' } });
    expect(t.status).toBe(200);
    expect(t.data.translation).toContain('[mock translation]');
    expect(t.data.notice).toMatch(/certified/);
    expect((await call(translate.POST, 'POST', '/api/translate', { who: A, body: { consent: true, text: 'x', to: 'klingon' } })).status).toBe(400);
    expect((await call(translate.POST, 'POST', '/api/translate', { who: A, body: { consent: true, text: '', to: 'hindi' } })).status).toBe(400);
  });
});

describe('cloud AI consent is enforced by the server', () => {
  const routes = [
    ['chat', chat.POST, '/api/chat', { message: 'hello there' }],
    ['research', research.POST, '/api/research', { question: 'Is this lawful in India?' }],
    ['translate', translate.POST, '/api/translate', { text: 'Hello', to: 'hindi' }],
    ['analysis', analysis.POST, '/api/analysis', { kind: 'summary', text: 'Some pasted text.' }],
    ['draft generate', gen.POST, '/api/drafts/generate', { instructions: 'Notice for unpaid rent of three months.' }],
  ] as const;

  it.each(routes)('%s refuses a request without consent, and nothing is recorded', async (_n, handler, path, body) => {
    const db = await getDb();
    const before = (await db.select().from(aiUsage)).length;
    for (const b of [body, { ...body, consent: false }]) {
      const r = await call(handler, 'POST', path, { who: A, body: b });
      expect(r.status).toBe(400);
      expect(r.data.code).toBe('consent_required');
    }
    expect((await db.select().from(aiUsage)).length).toBe(before);
  });

  it('draft edit refuses without consent', async () => {
    const g = await call(gen.POST, 'POST', '/api/drafts/generate', { who: A, body: { consent: true, instructions: 'Notice for unpaid rent of three months.' } });
    const id = g.data.draft.id;
    const r = await call(edit.POST, 'POST', `/api/drafts/${id}/edit`, { who: A, params: { id }, body: { instruction: 'Make it formal' } });
    expect([r.status, r.data.code]).toEqual([400, 'consent_required']);
  });

  it('"don\'t send case details" keeps the case out of the AI request', async () => {
    const c = (await call(cases.POST, 'POST', '/api/cases', { who: A, body: { title: 'SECRET-CASE-TITLE v. Hidden Party' } })).data.case;
    const seen: string[] = [];
    const spy = vi.spyOn(aiClient, 'streamText').mockImplementation(async function* (input: { system: string }) { seen.push(input.system); yield { type: 'done', result: { text: 'ok', model: 'mock', requests: 1, truncated: false, inputTokens: 1, outputTokens: 1 } } as never; });
    try {
      await call(chat.POST, 'POST', '/api/chat', { who: A, raw: true, body: { consent: true, sendCaseDetails: false, message: 'Summarise', caseId: c.id } }).then((r) => sse(r.res));
      await call(chat.POST, 'POST', '/api/chat', { who: A, raw: true, body: { consent: true, message: 'Summarise', caseId: c.id } }).then((r) => sse(r.res));
    } finally { spy.mockRestore(); }
    expect(seen[0]).not.toContain('SECRET-CASE-TITLE');
    expect(seen[1]).toContain('SECRET-CASE-TITLE');
  });
});
