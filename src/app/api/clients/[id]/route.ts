import { api, readBody, uuid } from '@/lib/http';
import { deleteClient, getClient, listCases, updateClient } from '@/lib/db/repos/practice';
import { clientPatch } from '@/lib/validation';

type P = { id: string };
export const GET = api<P>(async ({ db, advocateId, params }) => {
  const id = uuid(params.id);
  return { client: await getClient(db, advocateId, id), cases: await listCases(db, advocateId, { clientId: id, limit: 200, offset: 0 }) };
});
export const PATCH = api<P>(async ({ req, db, advocateId, params }) => ({ client: await updateClient(db, advocateId, uuid(params.id), await readBody(req, clientPatch)) }));
export const DELETE = api<P>(async ({ db, advocateId, params }) => { await deleteClient(db, advocateId, uuid(params.id)); return { ok: true }; });
