import { api } from '@/lib/http';
import { officeOverview } from '@/lib/db/repos/office';

/** GET /api/office: who is in the office. A junior sees the senior and colleagues; the senior also sees pending invites. */
export const GET = api(async ({ db, actorId }) => officeOverview(db, actorId));
