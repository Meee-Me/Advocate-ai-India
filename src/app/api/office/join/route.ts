import { api, readBody } from '@/lib/http';
import { joinOffice } from '@/lib/db/repos/office';
import { joinInput } from '@/lib/validation';

/** POST /api/office/join: use an invite code to work in a senior advocate's office. */
export const POST = api(async ({ req, db, actorId }) => joinOffice(db, actorId, (await readBody(req, joinInput, 2000)).code));
