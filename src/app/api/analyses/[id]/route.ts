import { api, uuid } from '@/lib/http';
import { deleteAnalysis, getAnalysis } from '@/lib/db/repos/work';

type P = { id: string };
export const GET = api<P>(async ({ db, advocateId, params }) => ({ analysis: await getAnalysis(db, advocateId, uuid(params.id)) }));
export const DELETE = api<P>(async ({ db, advocateId, params }) => { await deleteAnalysis(db, advocateId, uuid(params.id)); return { ok: true }; });
