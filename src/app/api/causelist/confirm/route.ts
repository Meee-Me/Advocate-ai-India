import { api, readBody } from '@/lib/http';
import { causeListConfirm } from '@/lib/validation';
import { applyCauseList } from '@/lib/db/repos/practice';
import { istDay, istInstant } from '@/lib/causelist';

/** POST /api/causelist/confirm: saves the rows the advocate reviewed and ticked. Every case id is checked to belong to them. */
export const POST = api(async ({ req, db, advocateId }) => {
  const b = await readBody(req, causeListConfirm);
  const { from, to } = istDay(b.hearingDate);
  return applyCauseList(db, advocateId, { at: istInstant(b.hearingDate, b.time), dayFrom: from, dayTo: to, court: b.court ?? null, rows: b.rows });
});
