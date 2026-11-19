import { api } from '@/lib/http';
import { listConversations } from '@/lib/db/repos/work';

export const GET = api(async ({ db, advocateId }) => ({ conversations: await listConversations(db, advocateId) }));
