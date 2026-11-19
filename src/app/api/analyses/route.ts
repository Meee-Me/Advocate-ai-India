import { api, readQuery } from '@/lib/http';
import { listAnalyses } from '@/lib/db/repos/work';
import { analysesQuery } from '@/lib/validation';

export const GET = api(async ({ req, db, advocateId }) => ({ analyses: await listAnalyses(db, advocateId, readQuery(req, analysesQuery)) }));
