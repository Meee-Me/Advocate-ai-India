import { api } from '@/lib/http';
import { dashboard } from '@/lib/db/repos/practice';

export const GET = api(async ({ db, advocateId }) => dashboard(db, advocateId));
