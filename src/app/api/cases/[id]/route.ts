import { api, readBody, uuid } from '@/lib/http';
import { deleteCase, getCaseDetail, updateCase } from '@/lib/db/repos/practice';
import { casePatch } from '@/lib/validation';

type P = { id: string };
export const GET = api<P>(async ({ db, advocateId, params }) => getCaseDetail(db, advocateId, uuid(params.id)));
export const PATCH = api<P>(async ({ req, db, advocateId, params }) => ({ case: await updateCase(db, advocateId, uuid(params.id), await readBody(req, casePatch)) }));
export const DELETE = api<P>(async ({ db, advocateId, params }) => { await deleteCase(db, advocateId, uuid(params.id)); return { ok: true }; });
