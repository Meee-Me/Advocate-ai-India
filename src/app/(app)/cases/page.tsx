'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { api, errorText, useApi } from '@/components/api';
import { Alert, Badge, Button, Card, Empty, Field, Input, Modal, PageHeader, Select, Textarea } from '@/components/ui';

interface Case { id: string; title: string; caseNumber: string | null; court: string | null; status: string; stage: string | null; clientName: string | null }
const STATUSES = ['open', 'pending', 'disposed', 'archived'];
const tone = (s: string) => (s === 'open' ? 'ok' : s === 'pending' ? 'warn' : 'neutral') as 'ok' | 'warn' | 'neutral';

function Inner() {
  const router = useRouter();
  const clientId = useSearchParams().get('clientId') ?? '';
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const list = useApi<{ cases: Case[] }>(`/api/cases?q=${encodeURIComponent(q)}&status=${status}${clientId ? `&clientId=${clientId}` : ''}`, { keepPreviousData: true });
  const clients = useApi<{ clients: { id: string; name: string }[] }>('/api/clients');
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ title: '', clientId: '', caseNumber: '', cnrNumber: '', court: '', caseType: '', ourSide: '', petitioner: '', respondent: '', description: '' });
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });

  const create = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(null);
    try { const r = await api<{ case: { id: string } }>('/api/cases', { body: { ...f, clientId: f.clientId || null } }); router.push(`/cases/${r.case.id}`); }
    catch (x) { setErr(errorText(x)); }
  };
  return (
    <>
      <PageHeader title="Cases" actions={<Button onClick={() => setAdding(true)}>+ New case</Button>} />
      <div className="mb-4 flex flex-wrap gap-2">
        <Input type="search" placeholder="Search title, number, party, court" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-md flex-1" aria-label="Search cases" />
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-40" aria-label="Filter by status"><option value="">All statuses</option>{STATUSES.map((s) => <option key={s}>{s}</option>)}</Select>
        {clientId && <Link href="/cases" className="self-center text-sm underline">Clear client filter</Link>}
      </div>
      {list.data?.cases.length === 0 && <Empty title="No cases found">Create a case to track hearings, notes, documents and drafts together.</Empty>}
      <div className="space-y-2">
        {list.data?.cases.map((c) => (
          <Link key={c.id} href={`/cases/${c.id}`}>
            <Card className="flex flex-wrap items-center justify-between gap-2 hover:border-brass">
              <div className="min-w-0"><p className="truncate font-serif text-lg font-bold">{c.title}</p>
                <p className="truncate text-sm text-muted">{[c.caseNumber, c.court, c.clientName].filter(Boolean).join(' · ') || '—'}</p></div>
              <div className="flex gap-2">{c.stage && <Badge>{c.stage}</Badge>}<Badge tone={tone(c.status)}>{c.status}</Badge></div>
            </Card>
          </Link>
        ))}
      </div>
      {adding && (
        <Modal title="New case" onClose={() => setAdding(false)}>
          <form onSubmit={create} className="space-y-3">
            {err && <Alert>{err}</Alert>}
            <Field label="Title" hint="e.g. Sharma v. State of Maharashtra"><Input required value={f.title} onChange={set('title')} maxLength={300} /></Field>
            <Field label="Client"><Select value={f.clientId} onChange={set('clientId')}><option value="">— none —</option>{clients.data?.clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Case number"><Input value={f.caseNumber} onChange={set('caseNumber')} /></Field>
              <Field label="CNR number" hint="16 characters"><Input value={f.cnrNumber} onChange={set('cnrNumber')} maxLength={16} /></Field>
              <Field label="Court"><Input value={f.court} onChange={set('court')} /></Field>
              <Field label="Case type"><Input value={f.caseType} onChange={set('caseType')} placeholder="Civil suit, Criminal appeal…" /></Field>
              <Field label="Petitioner / plaintiff"><Input value={f.petitioner} onChange={set('petitioner')} /></Field>
              <Field label="Respondent / defendant"><Input value={f.respondent} onChange={set('respondent')} /></Field>
            </div>
            <Field label="We appear for"><Input value={f.ourSide} onChange={set('ourSide')} placeholder="Petitioner, accused…" /></Field>
            <Field label="Description"><Textarea rows={3} value={f.description} onChange={set('description')} /></Field>
            <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setAdding(false)}>Cancel</Button><Button>Create case</Button></div>
          </form>
        </Modal>
      )}
    </>
  );
}
export default function Cases() { return <Suspense><Inner /></Suspense>; }
