import { api, readBody } from '@/lib/http';
import { getAdvocate, updateProfile } from '@/lib/db/repos/advocates';
import { profileInput } from '@/lib/validation';
import { HttpError } from '@/lib/http-errors';

// A junior's profile is their own, not the senior's.
export const GET = api(async ({ db, actorId }) => {
  const advocate = await getAdvocate(db, actorId);
  if (!advocate) throw new HttpError(401, 'Please sign in.', 'unauthorized');
  return { advocate };
});

export const PATCH = api(async ({ req, db, actorId }) => {
  const advocate = await updateProfile(db, actorId, await readBody(req, profileInput));
  if (!advocate) throw new HttpError(401, 'Please sign in.', 'unauthorized');
  return { advocate };
});
