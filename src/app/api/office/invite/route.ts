import { api, json } from '@/lib/http';
import { createInvite } from '@/lib/db/repos/office';

/** POST /api/office/invite: a single-use code for a junior. It is shown once and stored only as a hash. */
export const POST = api(async ({ db, actorId }) => json(await createInvite(db, actorId), 201), { senior: true });
