'use client';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { api, errorText, fmtDateTime, useApi } from '@/components/api';
import { AnalysisView } from '@/components/Results';
import { Alert, Badge, Button, Card, Field, Input, PageHeader, Spinner } from '@/components/ui';

interface DocInfo { document: { id: string; title: string; fileName: string; status: string; pageCount: number | null; textChars: number; textPreview: string; caseId: string | null }; analyses: { id: string; kind: string; title: string; createdAt: string }[] }
const KINDS = [['summary', 'Summarise'], ['contract', 'Analyse as contract'], ['judgment', 'Analyse as judgment']] as const;

export default function DocumentPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data, error, mutate } = useApi<DocInfo>(`/api/documents/${id}`);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [view, setView] = useState<{ kind: string; result: unknown; flags: never[]; readAs?: string } | null>(null);
  const [side, setSide] = useState('');
  if (error) return <Alert>{error.message}</Alert>;
  if (!data) return <Spinner label="Loading…" />;
  const d = data.document;

  const run = async (kind: string) => {
    setBusy(kind); setErr(null); setView(null);
    try { setView(await api('/api/analysis', { body: { kind, documentId: id, side: kind === 'contract' && side ? side : undefined } })); mutate(); }
    catch (x) { setErr(errorText(x)); } finally { setBusy(null); }
  };
  const open = async (aid: string) => {
    const r = await api<{ analysis: { kind: string; result: { flags: never[]; readAs: string } } }>(`/api/analyses/${aid}`);
    setView({ kind: r.analysis.kind, result: r.analysis.result, flags: r.analysis.result.flags, readAs: r.analysis.result.readAs });
  };
  const del = async () => { if (confirm('Delete this PDF and its saved analyses?')) { await api(`/api/documents/${id}`, { method: 'DELETE' }); router.push('/documents'); } };

  return (
    <>
      <PageHeader title={d.title} subtitle={`${d.fileName}${d.pageCount ? ` · ${d.pageCount} pages` : ''}`} actions={<><Link href={`/research`}><Button variant="secondary">Use in research</Button></Link><Button variant="danger" onClick={del}>Delete</Button></>} />
      {d.status !== 'uploaded' ? <Alert tone="warn">This file is not ready ({d.status.replace('_', ' ')}). Upload it again from the Documents page.</Alert> : (
        <div className="grid gap-5 lg:grid-cols-[1fr_18rem]">
          <div className="space-y-4">
            <Card>
              <h2 className="mb-2 text-lg font-bold">Analyse</h2>
              <Field label="For contract review: which party do you act for? (optional)"><Input value={side} onChange={(e) => setSide(e.target.value)} placeholder="e.g. the Buyer" maxLength={200} /></Field>
              <div className="mt-3 flex flex-wrap gap-2">{KINDS.map(([k, l]) => <Button key={k} variant={k === 'summary' ? 'primary' : 'secondary'} disabled={!!busy} onClick={() => run(k)}>{busy === k ? 'Working…' : l}</Button>)}</div>
              {busy && <div className="mt-3"><Spinner label="Analysing. Long documents can take a few minutes…" /></div>}
              {d.textChars < 400 && <p className="mt-3 text-xs text-muted">No text layer found (scanned PDF): the AI reads the page images directly, so quotes cannot be machine-checked.</p>}
            </Card>
            {err && <Alert>{err}</Alert>}
            {view && <>{view.readAs === 'pdf_pages' && <Alert tone="warn">Read from page images (scanned PDF): quotes and cited cases could not be checked against the text.</Alert>}<AnalysisView kind={view.kind} result={view.result} flags={view.flags} /></>}
          </div>
          <aside className="space-y-4">
            <Card><h2 className="mb-2 font-bold">Saved analyses</h2>
              {data.analyses.length ? <ul className="space-y-2 text-sm">{data.analyses.map((a) => <li key={a.id}><button className="text-left hover:underline" onClick={() => open(a.id)}><Badge tone="brass">{a.kind}</Badge></button><p className="text-xs text-muted">{fmtDateTime(a.createdAt)}</p></li>)}</ul> : <p className="text-sm text-muted">None yet.</p>}</Card>
            <Card><h2 className="mb-2 font-bold">Extracted text</h2><p className="mb-1 text-xs text-muted">{d.textChars.toLocaleString('en-IN')} characters</p><pre className="max-h-64 overflow-auto whitespace-pre-wrap text-xs">{d.textPreview || '(none)'}</pre></Card>
          </aside>
        </div>
      )}
    </>
  );
}
