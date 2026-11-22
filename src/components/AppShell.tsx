'use client';
import clsx from 'clsx';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { api, fmtDateTime, useApi } from './api';
import { Button, Disclaimer } from './ui';

/** Simple line icons (24x24), drawn here so the menu looks the same on every device. */
const ICONS: Record<string, string> = {
  dashboard: 'M3 3h7v9H3zM14 3h7v5h-7zM14 12h7v9h-7zM3 16h7v5H3z',
  chat: 'M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z',
  research: 'M12 3v18M5 7h14M5 7l-2 8a3 3 0 0 0 4 0L5 7zM19 7l-2 8a3 3 0 0 0 4 0l-2-8z',
  drafting: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z',
  documents: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M9 13h6M9 17h6',
  analysis: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-4.3-4.3',
  translate: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3z',
  cases: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  clients: 'M16 20v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9.5 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM21 20v-1a4 4 0 0 0-3-3.9M16 4.1a3.5 3.5 0 0 1 0 6.8',
  calendar: 'M5 4h14a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM3 10h18M8 2v4M16 2v4',
  profile: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  bell: 'M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0',
  menu: 'M4 6h16M4 12h16M4 18h16',
};
const Icon = ({ name, className = 'size-5' }: { name: string; className?: string }) => (
  <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className}><path d={ICONS[name]} /></svg>
);

const GROUPS = [
  { title: 'My practice', items: [
    { href: '/dashboard', label: 'Dashboard', icon: 'dashboard' },
    { href: '/cases', label: 'Cases', icon: 'cases' },
    { href: '/clients', label: 'Clients', icon: 'clients' },
    { href: '/calendar', label: 'Hearings', icon: 'calendar' },
  ] },
  { title: 'AI tools', items: [
    { href: '/chat', label: 'Legal chat', icon: 'chat' },
    { href: '/research', label: 'Research', icon: 'research' },
    { href: '/drafting', label: 'Drafting', icon: 'drafting' },
    { href: '/documents', label: 'Documents', icon: 'documents' },
    { href: '/analysis', label: 'Contract & judgment', icon: 'analysis' },
    { href: '/translate', label: 'Translate', icon: 'translate' },
  ] },
  { title: 'Account', items: [{ href: '/profile', label: 'Profile', icon: 'profile' }] },
];
const BOTTOM = [
  { href: '/dashboard', label: 'Home', icon: 'dashboard' },
  { href: '/chat', label: 'Chat', icon: 'chat' },
  { href: '/cases', label: 'Cases', icon: 'cases' },
  { href: '/calendar', label: 'Hearings', icon: 'calendar' },
];

interface Notifs { items: { id: string; title: string; body: string | null; readAt: string | null; createdAt: string }[]; unread: number }
interface Me { advocate: { displayName: string; email: string | null } }

export function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const [bell, setBell] = useState(false);
  const bellBox = useRef<HTMLDivElement>(null);
  // The reminders panel closes on Escape, on a click outside it, and when you move to another page.
  useEffect(() => setBell(false), [path]);
  useEffect(() => {
    if (!bell) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setBell(false);
    const onDown = (e: MouseEvent) => { if (!bellBox.current?.contains(e.target as Node)) setBell(false); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onDown); };
  }, [bell]);
  const me = useApi<Me>('/api/auth/me');
  const notifs = useApi<Notifs>('/api/notifications', { refreshInterval: 5 * 60_000 });

  const signOut = async () => {
    await api('/api/auth/logout', { method: 'POST', body: {} }).catch(() => undefined);
    window.location.href = '/login';
  };
  const markAll = async () => { await api('/api/notifications/read', { body: { all: true } }); notifs.mutate(); };

  const isActive = (href: string) => path === href || path.startsWith(href + '/');
  const nav = (
    <nav aria-label="Main" className="space-y-5">
      {GROUPS.map((g) => (
        <div key={g.title}>
          <p className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-wider text-white/45">{g.title}</p>
          <div className="flex flex-col gap-0.5">
            {g.items.map((n) => {
              const active = isActive(n.href);
              return (
                <Link key={n.href} href={n.href} onClick={() => setOpen(false)} aria-current={active ? 'page' : undefined}
                  className={clsx('flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm transition', active ? 'bg-white/15 font-semibold text-white shadow-sm' : 'text-white/75 hover:bg-white/10 hover:text-white')}>
                  <Icon name={n.icon} className={clsx('size-5 shrink-0', active ? 'text-brass-soft' : '')} />{n.label}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
  const initial = (me.data?.advocate.displayName ?? '?').trim().charAt(0).toUpperCase();

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[15rem_1fr]">
      <aside className="no-print hidden bg-navy p-4 md:sticky md:top-0 md:block md:h-dvh md:overflow-y-auto">
        <Link href="/dashboard" className="mb-6 block px-2 font-serif text-xl font-bold text-white">⚖ Advocate AI <span className="text-brass">India</span></Link>
        {nav}
      </aside>

      <div className="min-w-0">
        <header className="no-print sticky top-0 z-30 flex items-center justify-between gap-2 border-b border-line bg-paper/95 px-3 py-2 backdrop-blur sm:px-6">
          <button className="rounded-xl p-2 text-navy hover:bg-brass-soft md:hidden" aria-label="Open menu" aria-expanded={open} onClick={() => setOpen(true)}><Icon name="menu" className="size-6" /></button>
          <Link href="/dashboard" className="whitespace-nowrap font-serif text-[15px] font-bold md:hidden">Advocate AI <span className="text-brass">India</span></Link>
          <div className="hidden md:block" />
          <div ref={bellBox} className="relative flex items-center gap-1 sm:gap-2">
            <button className="relative rounded-xl p-2.5 text-navy hover:bg-brass-soft" aria-label={`Notifications${notifs.data?.unread ? `, ${notifs.data.unread} unread` : ''}`} onClick={() => setBell((v) => !v)}>
              <Icon name="bell" className="size-5" />{!!notifs.data?.unread && <span className="absolute right-0.5 top-0.5 min-w-4 rounded-full bg-danger px-1 text-[10px] font-bold text-white">{notifs.data.unread}</span>}
            </button>
            {bell && (
              <div className="absolute right-0 top-12 z-40 w-[min(22rem,calc(100vw-1.5rem))] rounded-xl border border-line bg-card p-3 shadow-xl">
                <div className="mb-2 flex items-center justify-between"><p className="font-serif font-bold">Reminders</p>
                  {!!notifs.data?.unread && <button className="text-xs text-navy-soft underline" onClick={markAll}>Mark all read</button>}</div>
                {notifs.data?.items.length ? (
                  <ul className="max-h-80 space-y-2 overflow-y-auto">
                    {notifs.data.items.map((n) => (
                      <li key={n.id} className={clsx('rounded-lg p-2 text-sm', n.readAt ? 'bg-paper' : 'bg-brass-soft')}>
                        <p className="font-medium">{n.title}</p>{n.body && <p className="text-xs text-muted">{n.body}</p>}
                        <p className="mt-0.5 text-[11px] text-muted">{fmtDateTime(n.createdAt)}</p>
                      </li>
                    ))}
                  </ul>
                ) : <p className="py-4 text-center text-sm text-muted">No reminders yet. They appear before your hearings.</p>}
              </div>
            )}
            <Link href="/profile" className="flex items-center gap-2.5 rounded-xl px-1.5 py-1 hover:bg-brass-soft" aria-label="Your profile">
              <span aria-hidden className="grid size-9 place-items-center rounded-full bg-navy text-sm font-bold text-white">{initial}</span>
              <span className="hidden text-left text-sm leading-tight sm:block">
                <span className="block font-semibold">{me.data?.advocate.displayName ?? ' '}</span>
                <span className="block text-xs text-muted">{me.data?.advocate.email ?? ' '}</span>
              </span>
            </Link>
            <Button variant="secondary" size="sm" onClick={signOut}>Sign out</Button>
          </div>
        </header>

        {open && (
          <div className="fixed inset-0 z-50 md:hidden" onClick={() => setOpen(false)}>
            <div className="absolute inset-0 bg-ink/50" />
            <div className="absolute inset-y-0 left-0 w-72 max-w-[85vw] overflow-y-auto bg-navy p-4" onClick={(e) => e.stopPropagation()}>
              <div className="mb-4 flex items-center justify-between"><span className="font-serif text-lg font-bold text-white">⚖ Advocate AI</span>
                <button className="p-2 text-white" aria-label="Close menu" onClick={() => setOpen(false)}>✕</button></div>
              {nav}
            </div>
          </div>
        )}

        <main className="mx-auto w-full max-w-6xl px-4 pb-28 pt-6 sm:px-8 sm:py-10 md:pb-10">
          {children}
          <div className="no-print mt-10"><Disclaimer /></div>
        </main>

        <nav aria-label="Quick links" className="no-print fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-line bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
          {BOTTOM.map((n) => (
            <Link key={n.href} href={n.href} aria-current={isActive(n.href) ? 'page' : undefined}
              className={clsx('flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium', isActive(n.href) ? 'text-navy' : 'text-muted')}>
              <Icon name={n.icon} className="size-6" />{n.label}
            </Link>
          ))}
          <button onClick={() => setOpen(true)} className="flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium text-muted"><Icon name="menu" className="size-6" />More</button>
        </nav>
      </div>
    </div>
  );
}
