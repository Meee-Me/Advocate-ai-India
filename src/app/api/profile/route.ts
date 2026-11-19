import { api, readBody } from '@/lib/http';
import { getAdvocate, updateProfile } from '@/lib/db/repos/advocates';
import { profileInput } from '@/lib/validation';
import { HttpError } from '@/lib/http-errors';

export const GET = api(async ({ db, advocateId }) => {
  const advocate = await getAdvocate(db, advocateId);
  if (!advocate) throw new HttpError(401, 'Please sign in.', 'unauthorized');
  return { advocate };
});

export const PATCH = api(async ({ req, db, advocateId }) => {
  const advocate = await updateProfile(db, advocateId, await readBody(req, profileInput));
  if (!advocate) throw new HttpError(401, 'Please sign in.', 'unauthorized');
  return { advocate };
});
