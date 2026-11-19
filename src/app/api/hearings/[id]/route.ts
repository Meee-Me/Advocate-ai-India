import { api, readBody, uuid } from '@/lib/http';
import { deleteHearing, updateHearing } from '@/lib/db/repos/practice';
import { hearingPatch } from '@/lib/validation';

type P = { id: string };
export const PATCH = api<P>(async ({ req, db, advocateId, params }) => ({ hearing: await updateHearing(db, advocateId, uuid(params.id), await readBody(req, hearingPatch)) }));
export const DELETE = api<P>(async ({ db, advocateId, params }) => { await deleteHearing(db, advocateId, uuid(params.id)); return { ok: true }; });
