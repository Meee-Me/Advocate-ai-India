'use client';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { api, errorText, fmtDate, fmtDateTime, useApi } from '@/components/api';
import { ClientUpdateModal } from '@/components/ClientUpdateModal';
import { HearingModal, type Hearing } from '@/components/HearingModal';
import { Alert, Badge, Button, Card, Empty, Field, Input, Modal, PageHeader, Select, Spinner, Textarea } from '@/components/ui';

interface Detail {
  case: Record<string, string | null> & { id: string; title: string; status: string };
  client: { id: string; name: string; phone?: string | null } | null;
  hearings: Hearing[];
  notes: { id: string; body: string; createdAt: string }[];
  documents: { id: string; title: string; status: string; pageCount: number | null }[];
  drafts: { id: string; title: string; docType: string }[];
}
const FIELDS: [string, string][] = [['caseNumber', 'Case number'], ['cnrNumber', 'CNR'], ['court', 'Court'], ['caseType', 'Type'], ['stage', 'Stage'], ['ourSide', 'We appear for'], ['petitioner', 'Petitioner / plaintiff'], ['respondent', 'Respondent / defendant'], ['opposingCounsel', 'Opposing counsel'], ['judge', 'Judge'], ['filingDate', 'Filing date']];

export default function CaseDetail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data, error, mutate } = useApi<Detail>(`/api/cases/${id}`);
  const [hearing, setHearing] = useState<Hearing | 'new' | null>(null);
  const [tell, setTell] = useState<Hearing | null>(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const [note, setNote] = useState('');
  const [err, setErr] = useState<string | null>(null);

  if (error) return <Alert>{error.message}</Alert>;
  if (!data) return <Spinner label="Loading case…" />;
  const c = data.case;

  const startEdit = () => { setForm(Object.fromEntries([['title', c.title], ['status', c.status], ['description', c.description ?? ''], ...FIELDS.map(([k]) => [k, c[k] ?? ''])])); setErr(null); setEditing(true); };
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    try { await api(`/api/cases/${id}`, { method: 'PATCH', body: form }); setEditing(false); mutate(); } catch (x) { setErr(errorText(x)); }
  };
  const addNote = async (e: React.FormEvent) => { e.preventDefault(); if (!note.trim()) return; await api(`/api/cases/${id}/notes`, { body: { body: note } }); setNote(''); mutate(); };
  const del = async () => { if (confirm('Delete this case with its hearings and notes? Documents and drafts stay but are unlinked.')) { await api(`/api/cases/${id}`, { method: 'DELETE' }); router.push('/cases'); } };

  return (
    <>
      <PageHeader title={c.title} subtitle={[c.caseNumber, c.court].filter(Boolean).join(' · ')}
        actions={<><Link href={`/chat?caseId=${id}`}><Button variant="secondary">Ask AI about this case</Button></Link><Button variant="secondary" onClick={startEdit}>Edit</Button><Button variant="danger" onClick={del}>Delete</Button></>} />
      <div className="mb-4 flex flex-wrap gap-2"><Badge tone={c.status === 'open' ? 'ok' : 'neutral'}>{c.status}</Badge>{data.client && <Badge tone="brass">Client: {data.client.name}</Badge>}</div>
      <div className="grid gap-5 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-5">
          <Card>
            <h2 className="mb-3 text-lg font-bold">Details</h2>
            <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
              {FIELDS.filter(([k]) => c[k]).map(([k, l]) => <div key={k}><dt className="text-xs text-muted">{l}</dt><dd>{k === 'filingDate' ? fmtDate(c[k]!) : c[k]}</dd></div>)}
            </dl>
            {c.description && <p className="mt-3 whitespace-pre-wrap text-sm">{c.description}</p>}
          </Card>
          <Card>
            <div className="mb-3 flex items-center justify-between"><h2 className="text-lg font-bold">Hearings</h2><Button size="sm" onClick={() => setHearing('new')}>+ Add</Button></div>
            {data.hearings.length ? (
              <ul className="divide-y divide-line">
                {data.hearings.map((h) => (
                  <li key={h.id} className="flex items-start justify-between gap-2 py-2.5">
                    <div><p className="font-medium">{fmtDateTime(h.hearingAt)}</p><p className="text-sm text-muted">{[h.purpose, h.court, h.courtroom && `Court ${h.courtroom}`].filter(Boolean).join(' · ')}</p>{h.notes && <p className="mt-1 text-sm">{h.notes}</p>}</div>
                    <div className="flex items-center gap-1"><Badge tone={h.status === 'scheduled' ? 'brass' : 'neutral'}>{h.status}</Badge>{data.client && h.status !== 'cancelled' && <Button size="sm" variant="ghost" onClick={() => setTell(h)}>Tell client</Button>}<Button size="sm" variant="ghost" onClick={() => setHearing(h)}>Edit</Button></div>
                  </li>
                ))}
              </ul>
            ) : <Empty title="No hearings recorded" />}
          </Card>
          <Card>
            <h2 className="mb-3 text-lg font-bold">Notes</h2>
            <form onSubmit={addNote} className="mb-3 space-y-2"><Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note…" aria-label="New note" /><Button size="sm" disabled={!note.trim()}>Add note</Button></form>
            <ul className="space-y-2">
              {data.notes.map((n) => (
                <li key={n.id} className="rounded-lg bg-paper p-3 text-sm"><p className="whitespace-pre-wrap">{n.body}</p>
                  <p className="mt-1 flex justify-between text-xs text-muted">{fmtDateTime(n.createdAt)}<button className="underline" onClick={async () => { await api(`/api/cases/${id}/notes/${n.id}`, { method: 'DELETE' }); mutate(); }}>delete</button></p></li>
              ))}
            </ul>
          </Card>
        </div>
        <div className="space-y-5">
          <Card>
            <div className="mb-2 flex items-center justify-between"><h2 className="text-lg font-bold">Documents</h2><Link className="text-sm underline" href={`/documents?caseId=${id}`}>Upload</Link></div>
            {data.documents.length ? <ul className="space-y-1 text-sm">{data.documents.map((d) => <li key={d.id}><Link className="hover:underline" href={`/documents/${d.id}`}>📄 {d.title}</Link>{d.pageCount ? ` · ${d.pageCount} pp` : ''}</li>)}</ul> : <p className="text-sm text-muted">No documents linked.</p>}
          </Card>
          <Card>
            <div className="mb-2 flex items-center justify-between"><h2 className="text-lg font-bold">Drafts</h2><Link className="text-sm underline" href={`/drafting?caseId=${id}`}>New draft</Link></div>
            {data.drafts.length ? <ul className="space-y-1 text-sm">{data.drafts.map((d) => <li key={d.id}><Link className="hover:underline" href={`/drafting/${d.id}`}>✎ {d.title}</Link></li>)}</ul> : <p className="text-sm text-muted">No drafts linked.</p>}
          </Card>
        </div>
      </div>
      {tell && data.client && (
        <ClientUpdateModal phone={data.client.phone ?? null} onClose={() => setTell(null)}
          facts={{ clientName: data.client.name, caseTitle: c.title, caseNumber: c.caseNumber, hearingAt: tell.hearingAt, status: tell.status, court: tell.court ?? c.court, courtroom: tell.courtroom, notes: tell.notes }} />
      )}
      {hearing && <HearingModal caseId={id} hearing={hearing === 'new' ? undefined : hearing} onClose={() => setHearing(null)} onSaved={() => mutate()} />}
      {editing && (
        <Modal title="Edit case" onClose={() => setEditing(false)}>
          <form onSubmit={save} className="space-y-3">
            {err && <Alert>{err}</Alert>}
            <Field label="Title"><Input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
            <Field label="Status"><Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>{['open', 'pending', 'disposed', 'archived'].map((s) => <option key={s}>{s}</option>)}</Select></Field>
            <div className="grid gap-3 sm:grid-cols-2">
              {FIELDS.map(([k, l]) => <Field key={k} label={l}><Input type={k === 'filingDate' ? 'date' : 'text'} value={form[k] ?? ''} onChange={(e) => setForm({ ...form, [k]: e.target.value })} /></Field>)}
            </div>
            <Field label="Description"><Textarea rows={4} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
            <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setEditing(false)}>Cancel</Button><Button>Save</Button></div>
          </form>
        </Modal>
      )}
    </>
  );
}
