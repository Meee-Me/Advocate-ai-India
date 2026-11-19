'use client';
import { useState } from 'react';
import { api, errorText, useApi } from '@/components/api';
import { Alert, Button, Card, Field, PageHeader, Select, Spinner, Textarea } from '@/components/ui';
import { LANGUAGES } from '@/lib/validation';

interface Out { translation: string; glossary: { source: string; target: string; note: string | null }[]; warnings: string[]; notice: string }

export default function Translate() {
  const me = useApi<{ advocate: { preferredLanguage: string } }>('/api/profile');
  const [text, setText] = useState('');
  const [from, setFrom] = useState('auto');
  const [to, setTo] = useState<string | null>(null);
  const [style, setStyle] = useState('faithful');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [out, setOut] = useState<Out | null>(null);
  const target = to ?? (me.data?.advocate.preferredLanguage === 'english' ? 'hindi' : me.data?.advocate.preferredLanguage) ?? 'hindi';

  const run = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null); setOut(null);
    try { setOut(await api('/api/translate', { body: { text, from, to: target, style } })); } catch (x) { setErr(errorText(x)); } finally { setBusy(false); }
  };
  return (
    <>
      <PageHeader title="Legal translation" subtitle="Between English and 12 Indian languages. Names, dates, amounts and section numbers are kept exactly." />
      <form onSubmit={run} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="From"><Select value={from} onChange={(e) => setFrom(e.target.value)} className="capitalize"><option value="auto">Detect language</option>{LANGUAGES.map((l) => <option key={l} value={l}>{l}</option>)}</Select></Field>
          <Field label="To"><Select value={target} onChange={(e) => setTo(e.target.value)} className="capitalize">{LANGUAGES.map((l) => <option key={l} value={l}>{l}</option>)}</Select></Field>
          <Field label="Style"><Select value={style} onChange={(e) => setStyle(e.target.value)}><option value="faithful">Faithful, formal</option><option value="plain">Plain language for a client</option></Select></Field>
        </div>
        <Field label="Text"><Textarea rows={10} required maxLength={40000} value={text} onChange={(e) => setText(e.target.value)} /></Field>
        <div className="flex items-center gap-3"><Button disabled={busy || !text.trim()}>{busy ? 'Translating…' : 'Translate'}</Button>{busy && <Spinner label="Translating…" />}</div>
      </form>
      {err && <div className="mt-4"><Alert>{err}</Alert></div>}
      {out && (
        <div className="mt-5 space-y-4">
          <Alert tone="warn">{out.notice}</Alert>
          <Card><div className="mb-2 flex items-center justify-between"><h2 className="text-lg font-bold">Translation</h2><Button size="sm" variant="secondary" onClick={() => navigator.clipboard.writeText(out.translation)}>Copy</Button></div><p className="whitespace-pre-wrap text-[15px] leading-relaxed" lang={target === 'english' ? 'en' : undefined}>{out.translation}</p></Card>
          {!!out.warnings.length && <Card><h2 className="mb-2 text-lg font-bold">Check these</h2><ul className="list-disc space-y-1 pl-5 text-sm">{out.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul></Card>}
          {!!out.glossary.length && <Card><h2 className="mb-2 text-lg font-bold">Glossary</h2><dl className="space-y-1.5 text-sm">{out.glossary.map((g, i) => <div key={i}><dt className="inline font-medium">{g.source}</dt> → <dd className="inline">{g.target}{g.note ? <span className="text-muted"> ({g.note})</span> : null}</dd></div>)}</dl></Card>}
        </div>
      )}
    </>
  );
}
