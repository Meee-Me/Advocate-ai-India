import { api, json, readBody, readQuery } from '@/lib/http';
import { createCase, listCases } from '@/lib/db/repos/practice';
import { caseInput, listQuery } from '@/lib/validation';

export const GET = api(async ({ req, db, advocateId }) => ({ cases: await listCases(db, advocateId, readQuery(req, listQuery)) }));
export const POST = api(async ({ req, db, advocateId }) => json({ case: await createCase(db, advocateId, await readBody(req, caseInput)) }, 201));
