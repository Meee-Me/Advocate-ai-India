'use client';
import Link from 'next/link';
import { useState } from 'react';
import clsx from 'clsx';
import { api, errorText } from '@/components/api';
import { askAiConsent } from '@/components/AiConsent';
import { Alert, Badge, Button, Field, Input, PageHeader, Spinner, Textarea } from '@/components/ui';

interface Row {
  itemNumber: string; caseNumber: string; parties: string; bench: string; courtroom: string; purpose: string;
  caseId: string | null; caseTitle: string | null; confidence: 'exact' | 'check' | 'none'; alreadyListed: boolean;
}
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

export default function CauseList() {
  const [text, setText] = useState('');
  const [date, setDate] = useState(today());
  const [court, setCourt] = useState('');
  const [busy, setBusy] = useState<'read' | 'save' | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [done, setDone] = useState<{ created: number; updated: number } | null>(null);

  const read = async (e: React.FormEvent) => {
    e.preventDefault();
    const c = await askAiConsent({ items: ['The cause list text you pasted. Your cases are matched on this site, and no case details are sent.'] });
    if (!c) return;
    setBusy('read'); setErr(null); setRows(null); setDone(null);
    try {
      const r = await api<{ rows: Row[] }>('/api/causelist/import', { body: { text, hearingDate: date, ...c } });
      setRows(r.rows);
      setPicked(new Set(r.rows.flatMap((x, i) => (x.caseId && x.confidence === 'exact' ? [i] : []))));
    } catch (x) { setErr(errorText(x)); } finally { setBusy(null); }
  };

  const save = async () => {
    if (!rows) return;
    setBusy('save'); setErr(null);
    try {
      const chosen = [...picked].sort((a, b) => a - b).map((i) => rows[i]).filter((r) => r.caseId);
      setDone(await api('/api/causelist/confirm', { body: { hearingDate: date, court, rows: chosen.map((r) => ({ caseId: r.caseId, itemNumber: r.itemNumber, bench: r.bench, courtroom: r.courtroom, purpose: r.purpose })) } }));
      setRows(null); setText('');
    } catch (x) { setErr(errorText(x)); } finally { setBusy(null); }
  };
  const toggle = (i: number) => setPicked((p) => { const n = new Set(p); if (n.has(i)) n.delete(i); else n.add(i); return n; });

  return (
    <>
      <PageHeader title="Cause list" subtitle="Paste the day's cause list. Your own cases are picked out, with their item numbers and court halls. Nothing is saved until you confirm." />

      {done && (
        <div className="mb-5 space-y-3">
          <Alert tone="ok">{done.created} added{done.updated ? `, ${done.updated} updated` : ''}.</Alert>
          <Link href="/dashboard"><Button>See today&apos;s list</Button></Link>
        </div>
      )}

      {!rows && (
        <form onSubmit={read} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Date of the cause list"><Input type="date" required value={date} onChange={(e) => setDate(e.target.value)} /></Field>
            <Field label="Court (optional)"><Input value={court} onChange={(e) => setCourt(e.target.value)} placeholder="High Court of Kerala" /></Field>
          </div>
          <Field label="Cause list text" hint="Copy it from the court's cause list PDF or page and paste it here. Scanned lists: upload the PDF under Documents first, then copy the text.">
            <Textarea rows={12} required maxLength={120000} value={text} onChange={(e) => setText(e.target.value)} />
          </Field>
          {err && <Alert>{err}</Alert>}
          <div className="flex items-center gap-3"><Button disabled={busy !== null || text.trim().length < 20}>{busy === 'read' ? 'Reading…' : 'Find my cases'}</Button>{busy === 'read' && <Spinner label="Reading the list…" />}</div>
        </form>
      )}

      {rows && (
        <div className="space-y-4">
          <p className="text-sm text-muted">{rows.length} rows found. {picked.size} of your cases ticked. Rows that are not your cases are left out.</p>
          <ol className="overflow-hidden rounded-2xl border border-line bg-card shadow-[var(--shadow-soft)]">
            {rows.map((r, i) => {
              const mine = !!r.caseId;
              return (
                <li key={i} className={clsx('grid grid-cols-[3.75rem_1fr] border-b border-line last:border-b-0 sm:grid-cols-[4.5rem_1fr]', !mine && 'bg-paper/60')}>
                  <span className="flex flex-col items-center justify-center border-r-[3px] border-double border-margin/70 px-1 py-3">
                    <span className="font-serif text-2xl font-bold leading-none text-navy">{r.itemNumber || '–'}</span>
                    <span className="mt-1 text-[11px] text-muted">item</span>
                  </span>
                  <label className={clsx('flex gap-3 px-4 py-3', mine ? 'cursor-pointer' : 'cursor-default')}>
                    <input type="checkbox" className="mt-1.5 size-5 shrink-0" disabled={!mine} checked={picked.has(i)} onChange={() => toggle(i)} aria-label={`Add item ${r.itemNumber} to my hearings`} />
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">{r.caseNumber || 'No case number'}</span>
                      <span className="block text-sm text-muted">{[r.parties, r.courtroom, r.bench, r.purpose].filter(Boolean).join(' · ')}</span>
                      <span className="mt-1.5 flex flex-wrap items-center gap-2 text-sm">
                        {r.confidence === 'exact' && <Badge tone="ok">Your case: {r.caseTitle}</Badge>}
                        {r.confidence === 'check' && <Badge tone="warn">Check: looks like {r.caseTitle}</Badge>}
                        {r.confidence === 'none' && <span className="text-muted">Not one of your cases. Add it under Cases first to include it.</span>}
                        {r.alreadyListed && <Badge tone="neutral">Already on this date: will be updated</Badge>}
                      </span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ol>
          {err && <Alert>{err}</Alert>}
          <div className="flex flex-wrap gap-2">
            <Button onClick={save} disabled={busy !== null || !picked.size}>{busy === 'save' ? 'Saving…' : `Add ${picked.size} to ${new Date(`${date}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`}</Button>
            <Button variant="secondary" onClick={() => setRows(null)}>Back to the pasted text</Button>
          </div>
        </div>
      )}
    </>
  );
}
