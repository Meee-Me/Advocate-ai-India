import { api, HttpError } from '@/lib/http';
import { officeOf, removeMember } from '@/lib/db/repos/office';

/** POST /api/office/leave: a junior leaves the office they joined. */
export const POST = api(async ({ db, actorId }) => {
  const mine = await officeOf(db, actorId);
  if (!mine) throw new HttpError(400, 'You are not in an office.', 'invalid');
  await removeMember(db, mine.ownerId, actorId);
  return { ok: true };
});
