import { api, readBody, uuid } from '@/lib/http';
import { deleteDraft, getDraft, listVersions, saveDraft } from '@/lib/db/repos/work';
import { draftPatch } from '@/lib/validation';

type P = { id: string };
export const GET = api<P>(async ({ db, advocateId, params }) => {
  const id = uuid(params.id);
  return { draft: await getDraft(db, advocateId, id), versions: await listVersions(db, advocateId, id) };
});
export const PATCH = api<P>(async ({ req, db, advocateId, params }) =>
  ({ draft: await saveDraft(db, advocateId, uuid(params.id), await readBody(req, draftPatch), 'Before manual edit') }));
export const DELETE = api<P>(async ({ db, advocateId, params }) => { await deleteDraft(db, advocateId, uuid(params.id)); return { ok: true }; });
