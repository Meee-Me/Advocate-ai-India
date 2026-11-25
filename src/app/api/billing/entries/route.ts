import { api, json, readBody, readQuery } from '@/lib/http';
import { createEntry, listEntries } from '@/lib/db/repos/billing';
import { feeEntryInput, feeEntryQuery } from '@/lib/validation';

// Fees are the senior advocate's business: juniors are refused ({ senior: true }).
export const GET = api(async ({ req, db, advocateId }) => {
  const q = readQuery(req, feeEntryQuery);
  return { entries: await listEntries(db, advocateId, { clientId: q.clientId, unbilled: q.unbilled === '1', limit: q.limit }) };
}, { senior: true });
export const POST = api(async ({ req, db, advocateId }) => json({ entry: await createEntry(db, advocateId, await readBody(req, feeEntryInput)) }, 201), { senior: true });
