import { randomUUID } from 'node:crypto';
import { api, badRequest, json, readBody } from '@/lib/http';
import { listDocuments } from '@/lib/db/repos/work';
import { assertOwnsCase } from '@/lib/db/repos/practice';
import { documents } from '@/lib/db/schema';
import { getStorage } from '@/lib/storage';
import { documentInit } from '@/lib/validation';
import { kindOfName, stripExt, SUPPORTED_TEXT } from '@/lib/documents';

export const GET = api(async ({ req, db, advocateId }) => {
  const caseId = new URL(req.url).searchParams.get('caseId') ?? undefined;
  return { documents: await listDocuments(db, advocateId, caseId) };
});

/** Step 1 of an upload: register the file and get a short-lived upload address. */
export const POST = api(async ({ req, db, advocateId }) => {
  const b = await readBody(req, documentInit);
  const kind = kindOfName(b.fileName);
  if (!kind) throw badRequest(`Supported files: ${SUPPORTED_TEXT}.`);
  await assertOwnsCase(db, advocateId, b.caseId);
  const id = randomUUID();
  const storagePath = `${advocateId}/${id}.${kind.exts[0]}`; // namespaced by advocate; never derived from the file name
  const upload = await getStorage().createUpload(storagePath, kind.mime, id);
  const [doc] = await db.insert(documents).values({
    id, advocateId, caseId: b.caseId ?? null, title: b.title || stripExt(b.fileName),
    fileName: b.fileName.replace(/[^\w.\- ()]/g, '_').slice(0, 200), mimeType: kind.mime, sizeBytes: b.sizeBytes, storagePath,
  }).returning();
  return json({ document: doc, upload }, 201);
});
