import { api, readBody } from '@/lib/http';
import { markNotificationsRead } from '@/lib/db/repos/practice';
import { markRead } from '@/lib/validation';

export const POST = api(async ({ req, db, advocateId }) => ({ marked: await markNotificationsRead(db, advocateId, await readBody(req, markRead)) }));
