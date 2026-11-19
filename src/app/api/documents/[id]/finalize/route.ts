import { eq } from 'drizzle-orm';
import { api, badRequest, HttpError, uuid } from '@/lib/http';
import { documents } from '@/lib/db/schema';
import { getDocumentRow } from '@/lib/db/repos/work';
import { getStorage } from '@/lib/storage';
import { hasUsableText, isPdf, MAX_PDF_BYTES, readPdf } from '@/lib/pdf/extract';

export const maxDuration = 120;

/** Step 2 of an upload: after the browser has sent the file, check it and read its text. */
export const POST = api<{ id: string }>(async ({ db, advocateId, params }) => {
  const d = await getDocumentRow(db, advocateId, uuid(params.id));
  const storage = getStorage();
  const bytes = await storage.read(d.storagePath);
  const fail = async (message: string, status = 400) => {
    await storage.remove(d.storagePath).catch(() => undefined);
    await db.update(documents).set({ status: 'failed' }).where(eq(documents.id, d.id));
    throw new HttpError(status, message, 'bad_file');
  };
  if (!bytes) throw badRequest('The file has not been uploaded yet.');
  if (bytes.length > MAX_PDF_BYTES) return fail('That PDF is larger than 25 MB.', 413);
  if (!isPdf(bytes)) return fail('That file is not a valid PDF.'); // trust the bytes, not the file name
  let info;
  try { info = await readPdf(bytes); } catch { return fail('That PDF could not be read. It may be damaged or password-protected.'); }
  const [doc] = await db.update(documents)
    .set({ status: 'uploaded', sizeBytes: bytes.length, pageCount: info.pages, extractedText: info.text, needsOcr: !hasUsableText(info.text, info.pages), ocrPagesDone: 0 })
    .where(eq(documents.id, d.id)).returning();
  return { document: { id: doc.id, title: doc.title, pageCount: doc.pageCount, textChars: info.text.length, scanned: doc.needsOcr, needsOcr: doc.needsOcr } };
});
