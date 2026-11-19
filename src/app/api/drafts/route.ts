import { api, json, readBody } from '@/lib/http';
import { createDraft, listDrafts } from '@/lib/db/repos/work';
import { draftCreate } from '@/lib/validation';

export const GET = api(async ({ req, db, advocateId }) => {
  const caseId = new URL(req.url).searchParams.get('caseId') ?? undefined;
  return { drafts: await listDrafts(db, advocateId, caseId) };
});
export const POST = api(async ({ req, db, advocateId }) => json({ draft: await createDraft(db, advocateId, await readBody(req, draftCreate)) }, 201));
