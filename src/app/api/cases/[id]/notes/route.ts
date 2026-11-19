import { api, json, readBody, uuid } from '@/lib/http';
import { addNote } from '@/lib/db/repos/practice';
import { noteInput } from '@/lib/validation';

export const POST = api<{ id: string }>(async ({ req, db, advocateId, params }) =>
  json({ note: await addNote(db, advocateId, uuid(params.id), (await readBody(req, noteInput)).body) }, 201));
