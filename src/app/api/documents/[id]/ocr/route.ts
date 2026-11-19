import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { api, badRequest, HttpError, readBody, uuid } from '@/lib/http';
import { ocrMaxPages } from '@/lib/config';
import { documents } from '@/lib/db/schema';
import { getDocumentRow } from '@/lib/db/repos/work';
import { getStorage } from '@/lib/storage';
import { ocrPages } from '@/lib/pdf/ocr';

export const maxDuration = 300;

const body = z.object({ batch: z.number().int().min(1).max(12).default(5) });

/**
 * Reads the next few pages of a scanned PDF. Call repeatedly until `done` is true: progress is kept in the
 * database, so a dropped connection or a time limit only costs the current batch. The text is read on this
 * server (Tesseract); no page image or text leaves it for OCR.
 */
export const POST = api<{ id: string }>(async ({ req, db, advocateId, params }) => {
  const { batch } = await readBody(req, body);
  const d = await getDocumentRow(db, advocateId, uuid(params.id));
  if (d.status !== 'uploaded') throw badRequest('That document has not finished uploading.');
  if (!d.needsOcr) throw badRequest('This PDF already has readable text, so it does not need OCR.');
  const pages = d.pageCount ?? 0;
  const limit = ocrMaxPages();
  if (pages > limit) throw new HttpError(413, `This scan has ${pages} pages; OCR is limited to ${limit} pages per document. Split the PDF and upload the parts.`, 'too_large');
  if (d.ocrPagesDone >= pages) return { done: true, pagesDone: d.ocrPagesDone, pageCount: pages, confidence: d.ocrConfidence };

  const bytes = await getStorage().read(d.storagePath);
  if (!bytes) throw new HttpError(404, 'The stored file could not be found.', 'not_found');
  const from = d.ocrPagesDone + 1;
  const to = Math.min(pages, from + batch - 1);
  let read;
  try { read = await ocrPages(bytes, from, to); }
  catch (error) {
    console.error('OCR failed:', error instanceof Error ? error.message : 'unknown');
    throw new HttpError(500, 'The scan could not be read. The file may be damaged. Try uploading it again.', 'ocr_failed');
  }
  const text = read.map((p) => `--- page ${p.page} ---\n${p.text}`).join('\n\n');
  const avg = read.reduce((n, p) => n + p.confidence, 0) / Math.max(1, read.length);
  // Running average over all pages read so far, weighted by pages.
  const confidence = d.ocrConfidence == null ? avg : (d.ocrConfidence * d.ocrPagesDone + avg * read.length) / (d.ocrPagesDone + read.length);
  const [doc] = await db.update(documents).set({
    extractedText: `${d.ocrPagesDone ? `${d.extractedText ?? ''}\n\n` : ''}${text}`.trim(),
    ocrPagesDone: to,
    ocrConfidence: confidence,
  }).where(eq(documents.id, d.id)).returning();
  return { done: doc.ocrPagesDone >= pages, pagesDone: doc.ocrPagesDone, pageCount: pages, confidence: Math.round(confidence) };
});
