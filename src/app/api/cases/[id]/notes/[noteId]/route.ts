import { api, uuid } from '@/lib/http';
import { deleteNote } from '@/lib/db/repos/practice';

export const DELETE = api<{ id: string; noteId: string }>(async ({ db, advocateId, params }) => {
  await deleteNote(db, advocateId, uuid(params.id), uuid(params.noteId));
  return { ok: true };
});
