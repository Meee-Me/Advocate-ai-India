'use client';
import { useState } from 'react';
import { api, errorText, useApi } from '@/components/api';
import { AnalysisView } from '@/components/Results';
import { Alert, Button, Card, Field, Input, PageHeader, Select, Spinner, Textarea } from '@/components/ui';

export default function Analysis() {
  const [kind, setKind] = useState<'contract' | 'judgment' | 'summary'>('contract');
  const [text, setText] = useState('');
  const [side, setSide] = useState('');
  const [docId, setDocId] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [view, setView] = useState<{ kind: string; result: unknown; flags: never[]; readAs?: string } | null>(null);
  const docs = useApi<{ documents: { id: string; title: string; status: string }[] }>('/api/documents');

  const run = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null); setView(null);
    try { setView(await api('/api/analysis', { body: { kind, text: docId ? undefined : text, documentId: docId || undefined, side: kind === 'contract' && side ? side : undefined } })); }
    catch (x) { setErr(errorText(x)); } finally { setBusy(false); }
  };
  const ready = docs.data?.documents.filter((d) => d.status === 'uploaded') ?? [];
  return (
    <>
      <PageHeader title="Contract & judgment analysis" subtitle="Quotes and cited cases are checked against your text: anything the AI quotes that is not actually in the document is marked in red." />
      <Card className="mb-5">
        <form onSubmit={run} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="What is it?"><Select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}><option value="contract">Contract / agreement</option><option value="judgment">Judgment / order</option><option value="summary">Other document (summary)</option></Select></Field>
            <Field label="Or use an uploaded PDF"><Select value={docId} onChange={(e) => setDocId(e.target.value)}><option value="">— paste text instead —</option>{ready.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}</Select></Field>
            {kind === 'contract' && <Field label="We act for (optional)"><Input value={side} onChange={(e) => setSide(e.target.value)} placeholder="e.g. the Licensee" maxLength={200} /></Field>}
          </div>
          {!docId && <Field label="Paste the full text"><Textarea rows={12} value={text} onChange={(e) => setText(e.target.value)} maxLength={700000} required /></Field>}
          <div className="flex items-center gap-3"><Button disabled={busy || (!docId && text.trim().length < 20)}>{busy ? 'Analysing…' : 'Analyse'}</Button>{busy && <Spinner label="This can take a minute or two…" />}</div>
        </form>
      </Card>
      {err && <Alert>{err}</Alert>}
      {view && <AnalysisView kind={view.kind} result={view.result} flags={view.flags} />}
    </>
  );
}
