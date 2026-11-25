import { api, uuid } from '@/lib/http';
import { removeMember } from '@/lib/db/repos/office';

type P = { id: string };
/** DELETE /api/office/members/[id]: the senior removes a junior; the junior's access ends at once. */
export const DELETE = api<P>(async ({ db, actorId, params }) => { await removeMember(db, actorId, uuid(params.id)); return { ok: true }; }, { senior: true });
