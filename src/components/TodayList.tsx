'use client';
import Link from 'next/link';
import { useMemo } from 'react';
import { itemOrder } from '@/lib/causelist';
import { useApi } from './api';
import { Badge, Button, Spinner } from './ui';

interface Row {
  id: string; caseId: string; caseTitle: string; caseNumber: string | null; court: string | null; courtroom: string | null;
  bench: string | null; itemNumber: string | null; purpose: string | null; status: string; hearingAt: string;
}
const TONE = { scheduled: 'brass', completed: 'ok', adjourned: 'warn', cancelled: 'danger' } as const;

/** Today's hearings drawn like the printed cause list: the item number in the left margin, then the case. */
export function TodayList() {
  const { from, to, label } = useMemo(() => {
    const d = new Date();
    const start = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    return { from: start.toISOString(), to: new Date(start.getTime() + 864e5).toISOString(), label: start.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' }) };
  }, []);
  const { data, isLoading } = useApi<{ hearings: Row[] }>(`/api/hearings?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&limit=200`);
  const rows = [...(data?.hearings ?? [])].sort((a, b) => itemOrder(a.itemNumber) - itemOrder(b.itemNumber) || a.hearingAt.localeCompare(b.hearingAt));

  return (
    <section aria-labelledby="today-title" className="overflow-hidden rounded-2xl border border-line bg-card shadow-[var(--shadow-soft)]">
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-line px-4 py-4 sm:px-6">
        <div>
          <h2 id="today-title" className="font-serif text-xl font-bold text-navy sm:text-2xl">Today in court</h2>
          <p className="text-sm text-muted">{label}{rows.length ? ` · ${rows.length} ${rows.length === 1 ? 'case' : 'cases'}` : ''}</p>
        </div>
        <Link href="/causelist"><Button variant="secondary" size="sm">Add today&apos;s cause list</Button></Link>
      </header>

      {isLoading && <div className="px-6 py-6"><Spinner label="Loading today’s list…" /></div>}
      {!isLoading && !rows.length && (
        <div className="px-4 py-10 text-center sm:px-6">
          <p className="font-serif text-lg">Nothing listed for today.</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted">Paste today&apos;s cause list and your cases are picked out for you, with item numbers and court halls.</p>
        </div>
      )}
      <ol className="divide-y divide-line">
        {rows.map((h) => (
          <li key={h.id}>
            <Link href={`/cases/${h.caseId}`} className="grid min-h-16 grid-cols-[3.75rem_1fr] hover:bg-brass-soft/60 sm:grid-cols-[4.5rem_1fr]">
              <span className="flex flex-col items-center justify-center border-r-[3px] border-double border-margin/70 px-1 py-3" aria-label={h.itemNumber ? `Item ${h.itemNumber}` : 'No item number'}>
                <span className="font-serif text-2xl font-bold leading-none text-navy">{h.itemNumber || '–'}</span>
                <span className="mt-1 text-[11px] text-muted">item</span>
              </span>
              <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{h.caseTitle}</span>
                  <span className="block truncate text-sm text-muted">{[h.caseNumber, h.courtroom, h.bench, h.purpose].filter(Boolean).join(' · ') || h.court || ' '}</span>
                </span>
                <Badge tone={TONE[h.status as keyof typeof TONE] ?? 'neutral'}>{h.status}</Badge>
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}
