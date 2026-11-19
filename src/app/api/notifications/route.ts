import { api } from '@/lib/http';
import { listNotifications } from '@/lib/db/repos/practice';

export const GET = api(async ({ db, advocateId }) => listNotifications(db, advocateId));
