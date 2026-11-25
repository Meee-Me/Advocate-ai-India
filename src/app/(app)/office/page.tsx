'use client';
import { useState } from 'react';
import { api, errorText, fmtDate, useApi } from '@/components/api';
import { Alert, Button, Card, Empty, Field, Input, PageHeader, Spinner } from '@/components/ui';
import { whatsappShare } from '@/lib/notify';

interface Person { id: string; name: string }
interface Overview {
  role: 'senior' | 'junior';
  owner: Person | null;
  members: (Person & { username: string | null; joinedAt: string })[];
  invites: { id: string; createdAt: string; expiresAt: string }[];
}

export default function Office() {
  const { data, mutate, isLoading } = useApi<Overview>('/api/office');
  const [err, setErr] = useState<string | null>(null);
  const [made, setMade] = useState<{ code: string; expiresAt: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>) => { setBusy(true); setErr(null); try { await fn(); await mutate(); } catch (x) { setErr(errorText(x)); } finally { setBusy(false); } };

  const invite = () => run(async () => { setMade(await api('/api/office/invite', { body: {} })); setCopied(false); });
  const join = (e: React.FormEvent) => { e.preventDefault(); return run(async () => { await api('/api/office/join', { body: { code } }); window.location.assign('/dashboard'); }); };
  const leave = () => { if (confirm('Leave this office? You will go back to your own practice.')) return run(async () => { await api('/api/office/leave', { body: {} }); window.location.assign('/dashboard'); }); };
  const remove = (m: Person) => { if (confirm(`Remove ${m.name} from your office? Their access ends at once, and hearings given to them become unassigned.`)) return run(() => api(`/api/office/members/${m.id}`, { method: 'DELETE' })); };
  const revoke = (id: string) => run(() => api(`/api/office/invite/${id}`, { method: 'DELETE' }));
  const message = made ? `Join my office on Advocate AI India. Sign up at ${typeof window !== 'undefined' ? window.location.origin : ''}/register, then open Office and enter this code: ${made.code} (valid until ${fmtDate(made.expiresAt)}).` : '';

  if (isLoading || !data) return <Spinner label="Loading…" />;

  if (data.role === 'junior') {
    return (
      <>
        <PageHeader title="Office" subtitle={`You work in ${data.owner?.name}'s office.`} />
        {err && <div className="mb-4"><Alert>{err}</Alert></div>}
        <Card>
          <p>You see and update {data.owner?.name}&apos;s cases, clients, hearings and documents. Fees and invoices stay with the senior advocate, and you cannot delete cases or clients.</p>
          <div className="mt-4"><Button variant="danger" onClick={leave} disabled={busy}>Leave this office</Button></div>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Office" subtitle="Your juniors work inside your practice with their own login. Give them court halls and see who covers what."
        actions={<Button onClick={invite} disabled={busy}>Invite a junior</Button>} />
      {err && <div className="mb-4"><Alert>{err}</Alert></div>}

      {made && (
        <Card className="mb-6 border-brass">
          <p className="text-sm text-muted">Invite code. It is shown only now, works once, and expires on {fmtDate(made.expiresAt)}.</p>
          <p className="my-2 select-all font-serif text-3xl font-bold tracking-wider text-navy">{made.code}</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={async () => { try { await navigator.clipboard.writeText(made.code); setCopied(true); } catch { /* clipboard blocked */ } }}>{copied ? 'Copied' : 'Copy code'}</Button>
            <a href={whatsappShare(message)} target="_blank" rel="noopener noreferrer"><Button variant="secondary" size="sm">Send on WhatsApp</Button></a>
          </div>
          <p className="mt-3 text-sm text-muted">Your junior signs up on this site, opens Office, and enters the code.</p>
        </Card>
      )}

      <h2 className="mb-3 text-lg font-bold">Juniors</h2>
      {!data.members.length ? <Empty title="No juniors yet">Invite a junior to share your cases and hearings with them.</Empty> : (
        <ul className="divide-y divide-line rounded-2xl border border-line bg-card shadow-[var(--shadow-soft)]">
          {data.members.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <span className="min-w-0 flex-1"><span className="block font-medium">{m.name}</span><span className="block text-sm text-muted">{[m.username, `joined ${fmtDate(m.joinedAt)}`].filter(Boolean).join(' · ')}</span></span>
              <Button size="sm" variant="danger" onClick={() => remove(m)} disabled={busy}>Remove</Button>
            </li>
          ))}
        </ul>
      )}

      {!!data.invites.length && (
        <>
          <h2 className="mb-3 mt-8 text-lg font-bold">Unused invites</h2>
          <ul className="divide-y divide-line rounded-2xl border border-line bg-card shadow-[var(--shadow-soft)]">
            {data.invites.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <span className="flex-1 text-sm">Created {fmtDate(i.createdAt)} · expires {fmtDate(i.expiresAt)}</span>
                <Button size="sm" variant="ghost" onClick={() => revoke(i.id)} disabled={busy}>Cancel invite</Button>
              </li>
            ))}
          </ul>
        </>
      )}

      {!data.members.length && (
        <Card className="mt-8">
          <h2 className="mb-1 text-lg font-bold">Work in someone else&apos;s office</h2>
          <p className="mb-3 text-sm text-muted">If a senior advocate gave you an invite code, enter it here. You will work in their practice and your own cases will be set aside while you are there.</p>
          <form onSubmit={join} className="flex flex-wrap items-end gap-3">
            <Field label="Invite code" className="min-w-0 flex-1"><Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="JR-ABCD-EFGH" autoCapitalize="characters" spellCheck={false} /></Field>
            <Button disabled={busy || code.trim().length < 6}>Join office</Button>
          </form>
        </Card>
      )}
    </>
  );
}
