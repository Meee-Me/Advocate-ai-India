'use client';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import clsx from 'clsx';
import { fmtDateTime, useApi } from '@/components/api';
import { HearingModal, type Hearing } from '@/components/HearingModal';
import { Badge, Button, Card, Empty, PageHeader } from '@/components/ui';

type H = Hearing & { caseTitle: string };
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export default function Calendar() {
  const [month, setMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const from = new Date(month.getFullYear(), month.getMonth(), 1);
  const to = new Date(month.getFullYear(), month.getMonth() + 1, 1);
  const { data, mutate } = useApi<{ hearings: H[] }>(`/api/hearings?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}&limit=200`, { keepPreviousData: true });
  // Fixed for the life of the page: a key built from new Date() on each render would never settle (endless refetching).
  const [since] = useState(() => new Date().toISOString());
  const upcoming = useApi<{ hearings: H[] }>(`/api/hearings?from=${encodeURIComponent(since)}&status=scheduled&limit=15`);
  const [modal, setModal] = useState<H | 'new' | null>(null);
  const [day, setDay] = useState<number | null>(null);

  const byDay = useMemo(() => {
    const m = new Map<number, H[]>();
    data?.hearings.forEach((h) => { const d = new Date(h.hearingAt).getDate(); m.set(d, [...(m.get(d) ?? []), h]); });
    return m;
  }, [data]);
  const lead = (from.getDay() + 6) % 7; // Monday first
  const cells = Array.from({ length: Math.ceil((lead + new Date(to.getTime() - 1).getDate()) / 7) * 7 }, (_, i) => i - lead + 1);
  const today = new Date();
  const isToday = (d: number) => d === today.getDate() && month.getMonth() === today.getMonth() && month.getFullYear() === today.getFullYear();
  const selected = day ? byDay.get(day) ?? [] : [];

  return (
    <>
      <PageHeader title="Hearings" subtitle="Reminders appear under the 🔔 bell. Download the calendar to get alerts on your phone."
        actions={<><Link href="/causelist"><Button variant="secondary">Paste cause list</Button></Link><a href="/api/hearings/ics" download><Button variant="secondary">Download .ics</Button></a><Button onClick={() => setModal('new')}>+ Add hearing</Button></>} />
      <div className="grid gap-5 lg:grid-cols-[1fr_20rem]">
        <Card>
          <div className="mb-3 flex items-center justify-between">
            <Button size="sm" variant="secondary" aria-label="Previous month" onClick={() => { setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1)); setDay(null); }}>←</Button>
            <h2 className="text-lg font-bold">{month.toLocaleString('en-IN', { month: 'long', year: 'numeric' })}</h2>
            <Button size="sm" variant="secondary" aria-label="Next month" onClick={() => { setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1)); setDay(null); }}>→</Button>
          </div>
          <div className="grid grid-cols-7 gap-1 text-center text-xs text-muted">{DAYS.map((d) => <div key={d}>{d}</div>)}</div>
          <div className="mt-1 grid grid-cols-7 gap-1" role="grid">
            {cells.map((d, i) => {
              const inMonth = d >= 1 && d <= new Date(to.getTime() - 1).getDate();
              const hs = inMonth ? byDay.get(d) : undefined;
              return inMonth ? (
                <button key={i} onClick={() => setDay(d)} aria-label={`${d}${hs ? `, ${hs.length} hearing${hs.length > 1 ? 's' : ''}` : ''}`}
                  className={clsx('flex min-h-14 flex-col items-center rounded-lg border p-1 text-sm', day === d ? 'border-brass bg-brass-soft' : 'border-line hover:bg-paper', isToday(d) && 'ring-2 ring-navy/40')}>
                  <span className="font-medium">{d}</span>{hs && <span className="mt-0.5 rounded-full bg-navy px-1.5 text-[10px] text-white">{hs.length}</span>}
                </button>
              ) : <div key={i} />;
            })}
          </div>
          {day && (
            <div className="mt-4 border-t border-line pt-3">
              <h3 className="mb-2 font-bold">{day} {month.toLocaleString('en-IN', { month: 'long' })}</h3>
              {selected.length ? <ul className="space-y-2">{selected.map((h) => (
                <li key={h.id} className="flex items-start justify-between gap-2 rounded-lg bg-paper p-2.5 text-sm"><div><Link href={`/cases/${h.caseId}`} className="font-medium hover:underline">{h.caseTitle}</Link>
                  <p className="text-muted">{new Date(h.hearingAt).toLocaleTimeString('en-IN', { timeStyle: 'short' })}{h.purpose ? ` · ${h.purpose}` : ''}</p></div>
                  <Button size="sm" variant="ghost" onClick={() => setModal(h)}>Edit</Button></li>))}</ul> : <p className="text-sm text-muted">No hearings on this day.</p>}
            </div>
          )}
        </Card>
        <Card>
          <h2 className="mb-3 text-lg font-bold">Next hearings</h2>
          {upcoming.data?.hearings.length ? (
            <ul className="space-y-3">{upcoming.data.hearings.map((h) => (
              <li key={h.id} className="text-sm"><Link href={`/cases/${h.caseId}`} className="font-medium hover:underline">{h.caseTitle}</Link><p className="text-muted">{fmtDateTime(h.hearingAt)}</p>{h.purpose && <Badge>{h.purpose}</Badge>}</li>))}</ul>
          ) : <Empty title="Nothing scheduled" />}
        </Card>
      </div>
      {modal && <HearingModal hearing={modal === 'new' ? undefined : modal} onClose={() => setModal(null)} onSaved={() => { mutate(); upcoming.mutate(); }} />}
    </>
  );
}
