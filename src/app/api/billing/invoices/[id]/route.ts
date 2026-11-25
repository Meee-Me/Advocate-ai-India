import { api, uuid } from '@/lib/http';
import { getInvoice } from '@/lib/db/repos/billing';

type P = { id: string };
export const GET = api<P>(async ({ db, advocateId, params }) => getInvoice(db, advocateId, uuid(params.id)));
