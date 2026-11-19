import { api, readBody, uuid } from '@/lib/http';
import { restoreVersion } from '@/lib/db/repos/work';
import { z } from 'zod';

export const POST = api<{ id: string }>(async ({ req, db, advocateId, params }) => {
  const { versionId } = await readBody(req, z.object({ versionId: z.string().uuid() }));
  return { draft: await restoreVersion(db, advocateId, uuid(params.id), versionId) };
});
