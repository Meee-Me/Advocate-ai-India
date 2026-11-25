'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import clsx from 'clsx';
import { api, errorText, fmtDate, useApi } from '@/components/api';
import { Alert, Badge, Button, Card, Empty, Field, Input, Modal, PageHeader, Select, Spinner, Textarea } from '@/components/ui';
import { FEE_KINDS, KIND_LABEL, formatRupees, isCharge, type FeeKind } from '@/lib/money';

interface Summary { clients: { clientId: string; clientName: string; charged: number; received: number; unbilled: number; balance: number }[]; totalDue: number; advanceHeld: number }
interface Entry { id: string; clientId: string; clientName: string; caseTitle: string | null; kind: FeeKind; amountPaise: number; incurredOn: string; note: string | null; invoiceId: string | null; invoiceNumber: string | null }
interface InvoiceRow { id: string; number: string; clientName: string; issuedOn: string; totalPaise: number }
const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const num = 'tabular-nums';

export default function Billing() {
  const summary = useApi<Summary>('/api/billing/summary');
  const [filter, setFilter] = useState('');
  const entries = useApi<{ entries: Entry[] }>(`/api/billing/entries${filter ? `?clientId=${filter}` : ''}`);
  const invoices = useApi<{ invoices: InvoiceRow[] }>('/api/billing/invoices');
  const [adding, setAdding] = useState(false);
  const [invoiceFor, setInvoiceFor] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const refresh = () => { summary.mutate(); entries.mutate(); invoices.mutate(); };

  const remove = async (e: Entry) => {
    if (!confirm('Delete this entry?')) return;
    try { await api(`/api/billing/entries/${e.id}`, { method: 'DELETE' }); refresh(); } catch (x) { setErr(errorText(x)); }
  };

  return (
    <>
      <PageHeader title="Billing" subtitle="Fees, court fees, expenses and payments per client, and numbered invoices. Amounts are in rupees."
        actions={<Button onClick={() => setAdding(true)}>+ Add entry</Button>} />
      {err && <div className="mb-4"><Alert>{err}</Alert></div>}

      <div className="grid gap-3 sm:grid-cols-2">
        <Card><p className="text-sm text-muted">Due from clients</p><p className={clsx('font-serif text-3xl font-bold text-navy', num)}>{summary.data ? formatRupees(summary.data.totalDue) : '–'}</p></Card>
        <Card><p className="text-sm text-muted">Advance held for clients</p><p className={clsx('font-serif text-3xl font-bold', num)}>{summary.data ? formatRupees(summary.data.advanceHeld) : '–'}</p></Card>
      </div>

      <h2 className="mb-3 mt-8 text-lg font-bold">By client</h2>
      {summary.isLoading && <Spinner label="Loading…" />}
      {summary.data && !summary.data.clients.length && <Empty title="Nothing recorded yet">Add a fee, an expense or a payment. Clients come from the Clients page.</Empty>}
      {!!summary.data?.clients.length && (
        <div className="overflow-x-auto rounded-2xl border border-line bg-card shadow-[var(--shadow-soft)]">
          <table className="w-full min-w-[34rem] text-sm">
            <thead><tr className="border-b border-line text-left text-muted"><th className="px-4 py-3 font-medium">Client</th><th className="px-4 py-3 text-right font-medium">Charged</th><th className="px-4 py-3 text-right font-medium">Received</th><th className="px-4 py-3 text-right font-medium">Balance</th><th className="px-4 py-3" /></tr></thead>
            <tbody>
              {summary.data.clients.map((c) => (
                <tr key={c.clientId} className="border-b border-line last:border-0">
                  <td className="px-4 py-3 font-medium">{c.clientName}</td>
                  <td className={clsx('px-4 py-3 text-right', num)}>{formatRupees(c.charged)}</td>
                  <td className={clsx('px-4 py-3 text-right', num)}>{formatRupees(c.received)}</td>
                  <td className={clsx('px-4 py-3 text-right font-semibold', num, c.balance > 0 ? 'text-warn' : c.balance < 0 ? 'text-ok' : 'text-muted')}>
                    {c.balance > 0 ? `${formatRupees(c.balance)} due` : c.balance < 0 ? `${formatRupees(-c.balance)} advance` : 'Settled'}
                  </td>
                  <td className="px-4 py-3 text-right">{c.unbilled > 0 && <Button size="sm" variant="secondary" onClick={() => setInvoiceFor(c.clientId)}>Create invoice</Button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mb-3 mt-8 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-bold">Entries</h2>
        <Select aria-label="Show entries for" className="max-w-xs" value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="">All clients</option>
          {summary.data?.clients.map((c) => <option key={c.clientId} value={c.clientId}>{c.clientName}</option>)}
        </Select>
      </div>
      {entries.data && !entries.data.entries.length ? <Empty title="No entries" /> : (
        <ul className="divide-y divide-line rounded-2xl border border-line bg-card shadow-[var(--shadow-soft)]">
          {entries.data?.entries.map((e) => (
            <li key={e.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3">
              <span className={clsx('w-24 shrink-0 text-sm text-muted', num)}>{fmtDate(e.incurredOn)}</span>
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{KIND_LABEL[e.kind]} · {e.clientName}</span>
                <span className="block truncate text-sm text-muted">{[e.caseTitle, e.note].filter(Boolean).join(' · ') || ' '}</span>
              </span>
              <span className={clsx('font-semibold', num, isCharge(e.kind) ? '' : 'text-ok')}>{isCharge(e.kind) ? '' : '+'}{formatRupees(e.amountPaise)}</span>
              {e.invoiceId ? <Link href={`/billing/invoices/${e.invoiceId}`}><Badge tone="brass">{e.invoiceNumber}</Badge></Link> : <Button size="sm" variant="ghost" onClick={() => remove(e)}>Delete</Button>}
            </li>
          ))}
        </ul>
      )}

      {!!invoices.data?.invoices.length && (
        <>
          <h2 className="mb-3 mt-8 text-lg font-bold">Invoices</h2>
          <ul className="divide-y divide-line rounded-2xl border border-line bg-card shadow-[var(--shadow-soft)]">
            {invoices.data.invoices.map((i) => (
              <li key={i.id}><Link href={`/billing/invoices/${i.id}`} className="flex min-h-12 flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 hover:bg-brass-soft/60">
                <span className="w-32 shrink-0 font-medium">{i.number}</span><span className="min-w-0 flex-1 truncate">{i.clientName}</span>
                <span className={clsx('text-sm text-muted', num)}>{fmtDate(i.issuedOn)}</span><span className={clsx('font-semibold', num)}>{formatRupees(i.totalPaise)}</span>
              </Link></li>
            ))}
          </ul>
        </>
      )}

      {adding && <EntryModal onClose={() => setAdding(false)} onSaved={refresh} />}
      {invoiceFor && <InvoiceModal clientId={invoiceFor} onClose={() => setInvoiceFor(null)} />}
    </>
  );
}

function EntryModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const clients = useApi<{ clients: { id: string; name: string }[] }>('/api/clients?limit=200');
  const cases = useApi<{ cases: { id: string; title: string; clientId: string | null }[] }>('/api/cases?limit=200');
  const [f, setF] = useState({ clientId: '', caseId: '', kind: 'professional_fee' as FeeKind, amount: '', incurredOn: todayIso(), note: '' });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try { await api('/api/billing/entries', { body: { ...f, caseId: f.caseId || null } }); onSaved(); onClose(); } catch (x) { setErr(errorText(x)); } finally { setBusy(false); }
  };
  const theirCases = cases.data?.cases.filter((c) => !f.clientId || c.clientId === f.clientId) ?? [];
  return (
    <Modal title="Add entry" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        {err && <Alert>{err}</Alert>}
        <Field label="Client"><Select required value={f.clientId} onChange={(e) => setF({ ...f, clientId: e.target.value, caseId: '' })}><option value="">Choose a client…</option>{clients.data?.clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="What is it"><Select value={f.kind} onChange={set('kind')}>{FEE_KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</Select></Field>
          <Field label="Amount (₹)"><Input required inputMode="decimal" value={f.amount} onChange={set('amount')} placeholder="1500" /></Field>
          <Field label="Date"><Input type="date" required value={f.incurredOn} onChange={set('incurredOn')} /></Field>
          <Field label="Case (optional)"><Select value={f.caseId} onChange={set('caseId')}><option value="">No case</option>{theirCases.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}</Select></Field>
        </div>
        <Field label="Note (optional)"><Textarea rows={2} value={f.note} onChange={set('note')} placeholder="Drafting the reply notice" /></Field>
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={busy}>{busy ? 'Saving…' : 'Save entry'}</Button></div>
      </form>
    </Modal>
  );
}

function InvoiceModal({ clientId, onClose }: { clientId: string; onClose: () => void }) {
  const router = useRouter();
  const { data } = useApi<{ entries: Entry[] }>(`/api/billing/entries?clientId=${clientId}&unbilled=1`);
  const [off, setOff] = useState<Set<string>>(new Set());
  const [date, setDate] = useState(todayIso());
  const [note, setNote] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const picked = data?.entries.filter((e) => !off.has(e.id)) ?? [];
  const total = picked.reduce((n, e) => n + e.amountPaise, 0);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try { const r = await api<{ invoice: { id: string } }>('/api/billing/invoices', { body: { clientId, entryIds: picked.map((p) => p.id), issuedOn: date, note } }); router.push(`/billing/invoices/${r.invoice.id}`); } catch (x) { setErr(errorText(x)); setBusy(false); }
  };
  return (
    <Modal title="Create invoice" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        {err && <Alert>{err}</Alert>}
        {!data && <Spinner label="Loading…" />}
        <ul className="divide-y divide-line rounded-xl border border-line">
          {data?.entries.map((e) => (
            <li key={e.id}><label className="flex cursor-pointer items-center gap-3 px-3 py-2.5">
              <input type="checkbox" className="size-5" checked={!off.has(e.id)} onChange={() => setOff((s) => { const n = new Set(s); if (n.has(e.id)) n.delete(e.id); else n.add(e.id); return n; })} />
              <span className="min-w-0 flex-1 text-sm"><span className="block font-medium">{KIND_LABEL[e.kind]}</span><span className="block truncate text-muted">{fmtDate(e.incurredOn)}{e.caseTitle ? ` · ${e.caseTitle}` : ''}{e.note ? ` · ${e.note}` : ''}</span></span>
              <span className={clsx('font-semibold', num)}>{formatRupees(e.amountPaise)}</span>
            </label></li>
          ))}
        </ul>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Invoice date"><Input type="date" required value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Note on the invoice (optional)"><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-line pt-3">
          <p className={clsx('font-serif text-xl font-bold', num)}>Total {formatRupees(total)}</p>
          <div className="flex gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={busy || !picked.length}>{busy ? 'Creating…' : 'Create invoice'}</Button></div>
        </div>
      </form>
    </Modal>
  );
}
