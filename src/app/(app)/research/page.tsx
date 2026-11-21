'use client';
import { useState } from 'react';
import { api, errorText, fmtDate, useApi } from '@/components/api';
import { askAiConsent } from '@/components/AiConsent';
import { ResearchView } from '@/components/Results';
import { Alert, Button, Card, Field, PageHeader, Select, Spinner, Textarea } from '@/components/ui';

interface Doc { id: string; title: string; status: string }
interface Past { id: string; title: string; createdAt: string }

export default function Research() {
  const [question, setQuestion] = useState('');
  const [materials, setMaterials] = useState('');
  const [docIds, setDocIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [out, setOut] = useState<{ result: unknown; flags: never[] } | null>(null);
  const docs = useApi<{ documents: Doc[] }>('/api/documents');
  const past = useApi<{ analyses: Past[] }>('/api/analyses?kind=research');

  const run = async (e: React.FormEvent) => {
    e.preventDefault();
    const c = await askAiConsent({ items: ['Your question', ...(materials ? ['The materials you typed'] : []), ...(docIds.length ? [`The extracted text of ${docIds.length} selected document(s)`] : [])] });
    if (!c) return;
    setBusy(true); setErr(null); setOut(null);
    try { setOut(await api('/api/research', { body: { question, materials: materials || undefined, documentIds: docIds, ...c } })); past.mutate(); }
    catch (x) { setErr(errorText(x)); } finally { setBusy(false); }
  };
  const load = async (id: string) => {
    const r = await api<{ analysis: { result: { flags: never[] } } }>(`/api/analyses/${id}`);
    setOut({ result: r.analysis.result, flags: r.analysis.result.flags });
  };
  return (
    <>
      <PageHeader title="Legal research" subtitle="Structured analysis of an issue. Paste judgments or statutes (or pick uploaded PDFs) and the memo will treat them as the verified sources. Everything else is labelled as the AI's memory." />
      <div className="grid gap-5 lg:grid-cols-[1fr_16rem]">
        <div className="space-y-4">
          <form onSubmit={run} className="space-y-3">
            <Field label="Legal question or issue"><Textarea rows={4} required minLength={5} maxLength={8000} value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="e.g. Whether a complaint under Section 138 NI Act is maintainable when the notice was sent by email only?" /></Field>
            <Field label="Materials (optional)" hint="Paste relevant judgments, statutory text or facts. Authorities found here are treated as verified."><Textarea rows={5} value={materials} onChange={(e) => setMaterials(e.target.value)} maxLength={200000} /></Field>
            {!!docs.data?.documents.filter((d) => d.status === 'uploaded').length && (
              <Field label="Use uploaded PDFs as sources" hint="Hold Ctrl / Cmd to select several (max 5)."><Select multiple className="h-28" value={docIds} onChange={(e) => setDocIds(Array.from(e.target.selectedOptions, (o) => o.value).slice(0, 5))}>
                {docs.data.documents.filter((d) => d.status === 'uploaded').map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}</Select></Field>
            )}
            <Button disabled={busy || question.trim().length < 5}>{busy ? 'Researching…' : 'Research'}</Button>
          </form>
          {busy && <Spinner label="Analysing. This can take a minute or two…" />}
          {err && <Alert>{err}</Alert>}
          {out && <ResearchView r={out.result} flags={out.flags} />}
        </div>
        <aside><Card><h2 className="mb-2 font-bold">Past research</h2>
          {past.data?.analyses.length ? <ul className="space-y-2 text-sm">{past.data.analyses.map((a) => <li key={a.id}><button className="text-left hover:underline" onClick={() => load(a.id)}>{a.title}</button><p className="text-xs text-muted">{fmtDate(a.createdAt)}</p></li>)}</ul> : <p className="text-sm text-muted">Nothing yet.</p>}</Card></aside>
      </div>
    </>
  );
}
