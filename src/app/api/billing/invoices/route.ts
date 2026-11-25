import { api, json, readBody } from '@/lib/http';
import { createInvoice, listInvoices } from '@/lib/db/repos/billing';
import { invoiceInput } from '@/lib/validation';

export const GET = api(async ({ db, advocateId }) => ({ invoices: await listInvoices(db, advocateId) }));
export const POST = api(async ({ req, db, advocateId }) => json({ invoice: await createInvoice(db, advocateId, await readBody(req, invoiceInput)) }, 201));
