import { api, HttpError, uuid } from '@/lib/http';
import { getDocumentRow } from '@/lib/db/repos/work';
import { getStorage } from '@/lib/storage';
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_MB } from '@/lib/limits';
import { storageConfig } from '@/lib/config';

/** Local-development upload target (production uploads go straight to Supabase Storage). */
export const PUT = api<{ id: string }>(async ({ req, db, advocateId, params }) => {
  if (storageConfig().driver !== 'local') throw new HttpError(404, 'Not found', 'not_found');
  const d = await getDocumentRow(db, advocateId, uuid(params.id));
  const buf = new Uint8Array(await req.arrayBuffer());
  if (buf.length > MAX_UPLOAD_BYTES) throw new HttpError(413, `That file is larger than ${MAX_UPLOAD_MB} MB.`, 'too_large');
  await getStorage().write!(d.storagePath, buf);
  return { ok: true };
});
