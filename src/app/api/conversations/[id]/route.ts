import { api, uuid } from '@/lib/http';
import { conversationMessages, deleteConversation, getConversation } from '@/lib/db/repos/work';

type P = { id: string };
export const GET = api<P>(async ({ db, advocateId, params }) => {
  const id = uuid(params.id);
  return { conversation: await getConversation(db, advocateId, id), messages: await conversationMessages(db, advocateId, id) };
});
export const DELETE = api<P>(async ({ db, advocateId, params }) => { await deleteConversation(db, advocateId, uuid(params.id)); return { ok: true }; });
