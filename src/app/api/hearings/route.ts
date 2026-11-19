import { api, json, readBody, readQuery } from '@/lib/http';
import { createHearing, listHearings } from '@/lib/db/repos/practice';
import { hearingInput, listQuery } from '@/lib/validation';

export const GET = api(async ({ req, db, advocateId }) => ({ hearings: await listHearings(db, advocateId, readQuery(req, listQuery)) }));
export const POST = api(async ({ req, db, advocateId }) => json({ hearing: await createHearing(db, advocateId, await readBody(req, hearingInput)) }, 201));
