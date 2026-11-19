import { api, json, readBody, readQuery } from '@/lib/http';
import { createClient, listClients } from '@/lib/db/repos/practice';
import { clientInput, listQuery } from '@/lib/validation';

export const GET = api(async ({ req, db, advocateId }) => ({ clients: await listClients(db, advocateId, readQuery(req, listQuery)) }));
export const POST = api(async ({ req, db, advocateId }) => json({ client: await createClient(db, advocateId, await readBody(req, clientInput)) }, 201));
