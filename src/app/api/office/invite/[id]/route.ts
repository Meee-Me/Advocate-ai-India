import { api, uuid } from '@/lib/http';
import { revokeInvite } from '@/lib/db/repos/office';

type P = { id: string };
export const DELETE = api<P>(async ({ db, actorId, params }) => { await revokeInvite(db, actorId, uuid(params.id)); return { ok: true }; }, { senior: true });
