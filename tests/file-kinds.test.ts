import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { createCanvas } from '@napi-rs/canvas';
import * as docs from '@/app/api/documents/route';
import * as doc from '@/app/api/documents/[id]/route';
import * as finalize from '@/app/api/documents/[id]/finalize/route';
import * as content from '@/app/api/documents/[id]/content/route';
import * as ocr from '@/app/api/documents/[id]/ocr/route';
import * as analysis from '@/app/api/analysis/route';
import { kindOfName } from '@/lib/documents';
import { call, setup, signIn, type Who } from './harness';

const APP = 'http://localhost:3999';

/** A minimal but real .docx: a zip with the three parts Word needs. */
async function makeDocx(paragraphs: string[]): Promise<Uint8Array> {
  const z = new JSZip();
  z.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  z.file('_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  z.file('word/document.xml', `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs.map((p) => `<w:p><w:r><w:t>${p}</w:t></w:r></w:p>`).join('')}</w:body></w:document>`);
  return new Uint8Array(await z.generateAsync({ type: 'uint8array' }));
}

/** A white PNG with large black text, for the OCR to read. */
function makePng(text: string): Uint8Array {
  const c = createCanvas(900, 200);
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, 900, 200);
  g.fillStyle = '#000'; g.font = 'bold 72px sans-serif'; g.fillText(text, 40, 120);
  return new Uint8Array(c.toBuffer('image/png'));
}

describe('more kinds of document', () => {
  let A: Who;
  let B: Who;
  beforeAll(async () => {
    process.env.STORAGE_DRIVER = 'local';
    process.env.LOCAL_STORAGE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'adv-kinds-'));
    await setup(); A = await signIn('Filer'); B = await signIn('Other');
  });

  const upload = async (who: Who, bytes: Uint8Array, name: string) => {
    const init = await call(docs.POST, 'POST', '/api/documents', { who, body: { fileName: name, sizeBytes: bytes.length } });
    if (init.status !== 201) return { init } as never;
    const id = init.data.document.id;
    const put = new Request(APP + init.data.upload.url, { method: 'PUT', headers: { host: 'localhost:3999', origin: APP, cookie: who.cookie }, body: bytes as BodyInit });
    expect((await content.PUT(put, { params: Promise.resolve({ id }) })).status).toBe(200);
    return { init, id, finalize: () => call(finalize.POST, 'POST', `/api/documents/${id}/finalize`, { who, params: { id } }) };
  };

  it('knows a file by its name, in any capitals, and refuses the rest', () => {
    expect(kindOfName('Order.PDF')?.id).toBe('pdf');
    expect(kindOfName('notice.docx')?.id).toBe('docx');
    expect(kindOfName('photo.JPEG')?.id).toBe('jpg');
    expect(kindOfName('scan.png')?.id).toBe('png');
    expect(kindOfName('notes.txt')?.id).toBe('txt');
    for (const bad of ['old.doc', 'sheet.xlsx', 'virus.exe', 'noextension', 'a.pdf.exe']) expect(kindOfName(bad)).toBeUndefined();
  });

  it('refuses an unsupported file name at the start of an upload', async () => {
    const r = await call(docs.POST, 'POST', '/api/documents', { who: A, body: { fileName: 'old.doc', sizeBytes: 100 } });
    expect(r.status).toBe(400);
    expect(r.data.error).toMatch(/Supported files: PDF, Word/);
  });

  it('reads a Word document and uses its text for analysis', async () => {
    const u = await upload(A, await makeDocx(['Notice under Section 138.', 'The drawer must pay within fifteen days of receipt.']), 'notice.docx');
    expect(u.init.data.document.mimeType).toContain('wordprocessingml');
    const f = await u.finalize();
    expect(f.status).toBe(200);
    expect(f.data.document).toMatchObject({ pageCount: null, scanned: false, needsOcr: false });
    const d = await call(doc.GET, 'GET', `/api/documents/${u.id}`, { who: A, params: { id: u.id } });
    expect(d.data.document.textPreview).toContain('fifteen days');
    const s = await call(analysis.POST, 'POST', '/api/analysis', { who: A, body: { consent: true, kind: 'summary', documentId: u.id } });
    expect(s.status).toBe(200);
    expect((await call(doc.GET, 'GET', `/api/documents/${u.id}`, { who: B, params: { id: u.id } })).status).toBe(404);
  });

  it('reads a plain text file, including Malayalam', async () => {
    const u = await upload(A, new TextEncoder().encode('ചെക്ക് മടങ്ങിയാൽ 30 ദിവസത്തിനകം നോട്ടീസ് അയയ്ക്കണം.\nSecond line.'), 'note.txt');
    const f = await u.finalize();
    expect(f.status).toBe(200);
    const d = await call(doc.GET, 'GET', `/api/documents/${u.id}`, { who: A, params: { id: u.id } });
    expect(d.data.document.textPreview).toContain('ചെക്ക്');
  });

  it('trusts the bytes, not the name: a renamed file is refused and removed', async () => {
    const fake = await upload(A, new TextEncoder().encode('MZ this is not a word document'), 'fake.docx');
    const r = await fake.finalize();
    expect(r.status).toBe(400);
    expect(r.data.error).toMatch(/not a valid Word/);
    const binary = await upload(A, new Uint8Array([0x4d, 0x5a, 0, 0, 1, 2, 3]), 'bin.txt');
    expect((await binary.finalize()).status).toBe(400);
    const notPng = await upload(A, new TextEncoder().encode('just text'), 'pic.png');
    expect((await notPng.finalize()).status).toBe(400);
    const empty = await upload(A, new TextEncoder().encode('   \n  '), 'empty.txt');
    expect((await empty.finalize()).status).toBe(400);
  });

  it('marks a photo for OCR and reads its text on the server', async () => {
    const u = await upload(A, makePng('PETITION 2024'), 'order-photo.png');
    const f = await u.finalize();
    expect(f.status).toBe(200);
    expect(f.data.document).toMatchObject({ pageCount: 1, needsOcr: true });
    const o = await call(ocr.POST, 'POST', `/api/documents/${u.id}/ocr`, { who: A, params: { id: u.id }, body: { batch: 5 } });
    expect(o.status).toBe(200);
    expect(o.data).toMatchObject({ done: true, pagesDone: 1, pageCount: 1 });
    const d = await call(doc.GET, 'GET', `/api/documents/${u.id}`, { who: A, params: { id: u.id } });
    expect(d.data.document.textPreview.toUpperCase()).toContain('PETITION');
  }, 60_000);
});
