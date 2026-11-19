'use client';
import clsx from 'clsx';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { api, fmtDateTime, useApi } from './api';
import { Button, Disclaimer } from './ui';

const NAV = [
  { href: '/dashboard', label: 'Dashboard', icon: '▦' },
  { href: '/chat', label: 'Legal chat', icon: '💬' },
  { href: '/research', label: 'Research', icon: '⚖' },
  { href: '/drafting', label: 'Drafting', icon: '✎' },
  { href: '/documents', label: 'Documents', icon: '📄' },
  { href: '/analysis', label: 'Contract & judgment', icon: '🔍' },
  { href: '/translate', label: 'Translate', icon: '🌐' },
  { href: '/cases', label: 'Cases', icon: '🗂' },
  { href: '/clients', label: 'Clients', icon: '👥' },
  { href: '/calendar', label: 'Hearings', icon: '🗓' },
  { href: '/profile', label: 'Profile', icon: '👤' },
];

interface Notifs { items: { id: string; title: string; body: string | null; readAt: string | null; createdAt: string }[]; unread: number }
interface Me { advocate: { displayName: string; deluxeHandle: string | null } }

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
  // Also re-checks the Deluxe Main sign-in (the API does it every 15 minutes).
  const me = useApi<Me>('/api/auth/me');
  const notifs = useApi<Notifs>('/api/notifications', { refreshInterval: 5 * 60_000 });

  const signOut = async () => {
    await api('/api/auth/logout', { method: 'POST', body: {} }).catch(() => undefined);
    window.location.href = '/login';
  };
  const markAll = async () => { await api('/api/notifications/read', { body: { all: true } }); notifs.mutate(); };

  const nav = (
    <nav aria-label="Main" className="flex flex-col gap-0.5">
      {NAV.map((n) => {
        const active = path === n.href || path.startsWith(n.href + '/');
        return (
          <Link key={n.href} href={n.href} onClick={() => setOpen(false)} aria-current={active ? 'page' : undefined}
            className={clsx('flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm', active ? 'bg-white/15 font-semibold text-white' : 'text-white/75 hover:bg-white/10 hover:text-white')}>
            <span aria-hidden className="w-5 text-center">{n.icon}</span>{n.label}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[15rem_1fr]">
      <aside className="no-print hidden bg-navy p-4 md:sticky md:top-0 md:block md:h-dvh md:overflow-y-auto">
        <Link href="/dashboard" className="mb-5 block px-2 font-serif text-lg font-bold text-white">⚖ Advocate AI <span className="text-brass">India</span></Link>
        {nav}
      </aside>

      <div className="min-w-0">
        <header className="no-print sticky top-0 z-30 flex items-center justify-between gap-2 border-b border-line bg-paper/95 px-3 py-2 backdrop-blur sm:px-6">
          <button className="rounded-lg p-2 text-xl md:hidden" aria-label="Open menu" aria-expanded={open} onClick={() => setOpen(true)}>☰</button>
          <Link href="/dashboard" className="font-serif font-bold md:hidden">Advocate AI <span className="text-brass">India</span></Link>
          <div className="hidden md:block" />
          <div ref={bellBox} className="relative flex items-center gap-2">
            <button className="relative rounded-lg p-2 hover:bg-brass-soft" aria-label={`Notifications${notifs.data?.unread ? `, ${notifs.data.unread} unread` : ''}`} onClick={() => setBell((v) => !v)}>
              🔔{!!notifs.data?.unread && <span className="absolute right-0.5 top-0.5 min-w-4 rounded-full bg-danger px-1 text-[10px] font-bold text-white">{notifs.data.unread}</span>}
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
            <div className="hidden text-right text-sm leading-tight sm:block">
              <p className="font-medium">{me.data?.advocate.displayName ?? ' '}</p>
              <p className="text-xs text-muted">Signed in with Deluxe Main</p>
            </div>
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

        <main className="mx-auto w-full max-w-6xl px-3 py-5 sm:px-6 sm:py-8">
          {children}
          <div className="no-print mt-10"><Disclaimer /></div>
        </main>
      </div>
    </div>
  );
}
