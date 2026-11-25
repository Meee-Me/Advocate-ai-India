import { api } from '@/lib/http';
import { billingSummary } from '@/lib/db/repos/billing';

export const GET = api(async ({ db, advocateId }) => billingSummary(db, advocateId), { senior: true });
