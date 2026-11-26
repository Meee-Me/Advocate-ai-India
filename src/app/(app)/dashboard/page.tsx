'use client';
import Link from 'next/link';
import { fmtDateTime, useApi } from '@/components/api';
import { TodayList } from '@/components/TodayList';
import { Badge, Card, Empty, PageHeader, Spinner } from '@/components/ui';

interface Dash {
  stats: { openCases: number; clients: number; documents: number; hearingsThisWeek: number; unreadNotifications: number };
  upcomingHearings: { id: string; hearingAt: string; caseId: string; caseTitle: string; caseNumber: string | null; purpose: string | null; court: string | null }[];
  recentCases: { id: string; title: string; status: string; court: string | null; clientName: string | null }[];
}
const QUICK = [['/chat', 'Ask a legal question'], ['/drafting', 'Draft a document'], ['/documents', 'Upload a file'], ['/research', 'Research an issue'], ['/translate', 'Translate'], ['/cases', 'New case']] as const;

export default function Dashboard() {
  const { data, error, isLoading } = useApi<Dash>('/api/dashboard');
  const stat = (label: string, v: number | undefined, href: string) => (
    <Link href={href} className="bg-card px-4 py-4 hover:bg-brass-soft/60 sm:px-6">
      <p className="font-serif text-3xl font-bold tabular-nums">{v ?? '–'}</p><p className="text-sm text-muted">{label}</p>
    </Link>
  );
  return (
    <>
      <PageHeader title="Dashboard" subtitle="Your practice at a glance." />
      <div className="mb-6"><TodayList /></div>
      {isLoading && <Spinner label="Loading…" />}
      {error && <p className="text-danger" role="alert">{error.message}</p>}
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-line bg-line shadow-[var(--shadow-soft)] lg:grid-cols-4">
        {stat('Open cases', data?.stats.openCases, '/cases')}
        {stat('Hearings in 7 days', data?.stats.hearingsThisWeek, '/calendar')}
        {stat('Clients', data?.stats.clients, '/clients')}
        {stat('Files uploaded', data?.stats.documents, '/documents')}
      </div>
      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        <Card>
          <h2 className="mb-3 text-lg font-bold">Upcoming hearings</h2>
          {data?.upcomingHearings.length ? (
            <ul className="divide-y divide-line">
              {data.upcomingHearings.map((h) => (
                <li key={h.id} className="py-2.5"><Link href={`/cases/${h.caseId}`} className="font-medium hover:underline">{h.caseTitle}</Link>
                  <p className="text-sm text-muted">{fmtDateTime(h.hearingAt)}{h.purpose ? ` · ${h.purpose}` : ''}{h.court ? ` · ${h.court}` : ''}</p></li>
              ))}
            </ul>
          ) : <Empty title="No upcoming hearings">Add hearing dates from a case or the Hearings page.</Empty>}
        </Card>
        <Card>
          <h2 className="mb-3 text-lg font-bold">Recent cases</h2>
          {data?.recentCases.length ? (
            <ul className="divide-y divide-line">
              {data.recentCases.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-2 py-2.5">
                  <div className="min-w-0"><Link href={`/cases/${c.id}`} className="block truncate font-medium hover:underline">{c.title}</Link>
                    <p className="truncate text-sm text-muted">{[c.clientName, c.court].filter(Boolean).join(' · ') || '—'}</p></div>
                  <Badge tone={c.status === 'open' ? 'ok' : 'neutral'}>{c.status}</Badge>
                </li>
              ))}
            </ul>
          ) : <Empty title="No cases yet">Create your first case to start organising your work.</Empty>}
        </Card>
      </div>
      <h2 className="mb-3 mt-8 text-lg font-bold">Quick start</h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {QUICK.map(([href, label]) => <Link key={href} href={href} className="rounded-xl border border-line bg-card px-4 py-3 text-sm font-medium hover:bg-brass-soft">{label}</Link>)}
      </div>
    </>
  );
}
