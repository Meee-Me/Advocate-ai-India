import { eq } from 'drizzle-orm';
import { api, badRequest, HttpError, uuid } from '@/lib/http';
import { documents } from '@/lib/db/schema';
import { getDocumentRow } from '@/lib/db/repos/work';
import { getStorage } from '@/lib/storage';
import { FileProblem, readFile } from '@/lib/pdf/read-file';
import { kindOfMime } from '@/lib/documents';
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_MB } from '@/lib/limits';

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
  if (bytes.length > MAX_UPLOAD_BYTES) return fail(`That file is larger than ${MAX_UPLOAD_MB} MB.`, 413);
  const kind = kindOfMime(d.mimeType);
  if (!kind) return fail('That kind of file is not supported.');
  let info;
  try { info = await readFile(kind, bytes); } catch (e) { return fail(e instanceof FileProblem ? e.message : 'That file could not be read.'); } // trust the bytes, not the file name
  const [doc] = await db.update(documents)
    .set({ status: 'uploaded', sizeBytes: bytes.length, pageCount: info.pages, extractedText: info.text, needsOcr: info.needsOcr, ocrPagesDone: 0 })
    .where(eq(documents.id, d.id)).returning();
  return { document: { id: doc.id, title: doc.title, pageCount: doc.pageCount, textChars: info.text.length, scanned: doc.needsOcr, needsOcr: doc.needsOcr } };
});
