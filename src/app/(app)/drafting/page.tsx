'use client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { api, errorText, fmtDate, useApi } from '@/components/api';
import { askAiConsent } from '@/components/AiConsent';
import { Alert, Button, Card, Empty, Field, Input, PageHeader, Select, Spinner, Textarea } from '@/components/ui';
import { DRAFT_TYPES } from '@/lib/legal/draft-types';
import { LANGUAGES } from '@/lib/validation';

function Inner() {
  const router = useRouter();
  const caseId = useSearchParams().get('caseId');
  const list = useApi<{ drafts: { id: string; title: string; docType: string; updatedAt: string }[] }>(`/api/drafts${caseId ? `?caseId=${caseId}` : ''}`);
  const [f, setF] = useState({ docType: 'legal_notice', title: '', instructions: '', language: 'english' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });

  const generate = async (e: React.FormEvent) => {
    e.preventDefault();
    const c = await askAiConsent({ items: ['The facts and instructions you wrote'], hasCase: Boolean(caseId) });
    if (!c) return;
    setBusy(true); setErr(null);
    try { const r = await api<{ draft: { id: string } }>('/api/drafts/generate', { body: { ...f, title: f.title || undefined, caseId, ...c } }); router.push(`/drafting/${r.draft.id}`); }
    catch (x) { setErr(errorText(x)); setBusy(false); }
  };
  const blank = async () => {
    const r = await api<{ draft: { id: string } }>('/api/drafts', { body: { title: f.title || 'Untitled draft', docType: f.docType, language: f.language, caseId } });
    router.push(`/drafting/${r.draft.id}`);
  };
  return (
    <>
      <PageHeader title="Drafting" subtitle="Describe the facts; the AI writes a first draft with [●] placeholders for anything you did not supply. It never invents facts or case law." />
      <div className="grid gap-5 lg:grid-cols-[1fr_20rem]">
        <Card>
          <form onSubmit={generate} className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Document type"><Select value={f.docType} onChange={set('docType')}>{Object.entries(DRAFT_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
              <Field label="Language"><Select value={f.language} onChange={set('language')} className="capitalize">{LANGUAGES.map((l) => <option key={l} value={l}>{l}</option>)}</Select></Field>
              <Field label="Title (optional)"><Input value={f.title} onChange={set('title')} maxLength={200} /></Field>
            </div>
            <Field label="Facts and instructions" hint="Parties, dates, amounts, what happened, relief sought. The more you give, the fewer placeholders."><Textarea rows={9} required minLength={10} maxLength={30000} value={f.instructions} onChange={set('instructions')} /></Field>
            {err && <Alert>{err}</Alert>}
            <div className="flex flex-wrap items-center gap-2"><Button disabled={busy || f.instructions.trim().length < 10}>{busy ? 'Drafting…' : 'Generate draft'}</Button>
              <Button type="button" variant="secondary" onClick={blank}>Start blank</Button>{busy && <Spinner label="Writing the draft. This can take a minute…" />}</div>
          </form>
        </Card>
        <Card>
          <h2 className="mb-2 font-bold">Your drafts</h2>
          {list.data?.drafts.length ? <ul className="space-y-2">{list.data.drafts.map((d) => <li key={d.id} className="text-sm"><Link className="font-medium hover:underline" href={`/drafting/${d.id}`}>{d.title}</Link><p className="text-xs text-muted">{DRAFT_TYPES[d.docType] ?? d.docType} · {fmtDate(d.updatedAt)}</p></li>)}</ul> : <Empty title="No drafts yet" />}
        </Card>
      </div>
    </>
  );
}
export default function Drafting() { return <Suspense><Inner /></Suspense>; }
