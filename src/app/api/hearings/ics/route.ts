import { api } from '@/lib/http';
import { listHearings } from '@/lib/db/repos/practice';
import { buildIcs } from '@/lib/ics';

/** Download of the hearing calendar (past 30 days onward) for Google / Apple / Outlook calendars. */
export const GET = api(async ({ db, advocateId }) => {
  const rows = await listHearings(db, advocateId, { from: new Date(Date.now() - 30 * 864e5), limit: 200, offset: 0 });
  return new Response(buildIcs(rows.filter((h) => h.status !== 'cancelled')), {
    headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': 'attachment; filename="hearings.ics"' },
  });
});
