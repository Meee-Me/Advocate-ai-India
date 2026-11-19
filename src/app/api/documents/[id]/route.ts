import { eq } from 'drizzle-orm';
import { api, uuid } from '@/lib/http';
import { documents } from '@/lib/db/schema';
import { getDocumentRow, listAnalyses } from '@/lib/db/repos/work';
import { getStorage } from '@/lib/storage';

type P = { id: string };
export const GET = api<P>(async ({ db, advocateId, params }) => {
  const d = await getDocumentRow(db, advocateId, uuid(params.id));
  const { extractedText, storagePath: _unused, ...rest } = d; // eslint-disable-line @typescript-eslint/no-unused-vars
  return { document: { ...rest, textChars: extractedText?.length ?? 0, textPreview: (extractedText ?? '').slice(0, 3000) }, analyses: await listAnalyses(db, advocateId, { documentId: d.id }) };
});
export const DELETE = api<P>(async ({ db, advocateId, params }) => {
  const d = await getDocumentRow(db, advocateId, uuid(params.id));
  await getStorage().remove(d.storagePath).catch(() => undefined);
  await db.delete(documents).where(eq(documents.id, d.id));
  return { ok: true };
});
