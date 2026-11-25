import { api, uuid } from '@/lib/http';
import { deleteEntry } from '@/lib/db/repos/billing';

type P = { id: string };
export const DELETE = api<P>(async ({ db, advocateId, params }) => { await deleteEntry(db, advocateId, uuid(params.id)); return { ok: true }; }, { senior: true });
