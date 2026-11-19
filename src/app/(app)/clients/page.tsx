'use client';
import Link from 'next/link';
import { useState } from 'react';
import { api, errorText, refresh, useApi } from '@/components/api';
import { Alert, Button, Card, Empty, Field, Input, Modal, PageHeader, Textarea } from '@/components/ui';

interface Client { id: string; name: string; email: string | null; phone: string | null; address: string | null; notes: string | null }
const blank = { name: '', email: '', phone: '', address: '', notes: '' };

export default function Clients() {
  const [q, setQ] = useState('');
  const list = useApi<{ clients: Client[] }>(`/api/clients?q=${encodeURIComponent(q)}`, { keepPreviousData: true });
  const [editing, setEditing] = useState<Client | 'new' | null>(null);
  const [form, setForm] = useState(blank);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const open = (c: Client | 'new') => {
    setEditing(c); setErr(null);
    setForm(c === 'new' ? blank : { name: c.name, email: c.email ?? '', phone: c.phone ?? '', address: c.address ?? '', notes: c.notes ?? '' });
  };
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try {
      if (editing === 'new') await api('/api/clients', { body: form });
      else if (editing) await api(`/api/clients/${editing.id}`, { method: 'PATCH', body: form });
      setEditing(null); refresh('/api/clients');
    } catch (x) { setErr(errorText(x)); } finally { setBusy(false); }
  };
  const remove = async (c: Client) => {
    if (!confirm(`Delete ${c.name}? Their cases are kept but will no longer be linked to a client.`)) return;
    await api(`/api/clients/${c.id}`, { method: 'DELETE' }); refresh('/api/clients');
  };
  const set = (k: keyof typeof blank) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm({ ...form, [k]: e.target.value });

  return (
    <>
      <PageHeader title="Clients" actions={<Button onClick={() => open('new')}>+ New client</Button>} />
      <Input type="search" placeholder="Search by name, email or phone" value={q} onChange={(e) => setQ(e.target.value)} className="mb-4 max-w-md" aria-label="Search clients" />
      {list.data?.clients.length === 0 && <Empty title={q ? 'No matching clients' : 'No clients yet'}>Add clients to link them to cases.</Empty>}
      <div className="grid gap-3 sm:grid-cols-2">
        {list.data?.clients.map((c) => (
          <Card key={c.id}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0"><p className="truncate font-serif text-lg font-bold">{c.name}</p>
                <p className="truncate text-sm text-muted">{[c.phone, c.email].filter(Boolean).join(' · ') || 'No contact details'}</p></div>
              <div className="flex shrink-0 gap-1"><Button size="sm" variant="ghost" onClick={() => open(c)}>Edit</Button><Button size="sm" variant="danger" onClick={() => remove(c)}>Delete</Button></div>
            </div>
            {c.notes && <p className="mt-2 line-clamp-2 text-sm text-muted">{c.notes}</p>}
            <Link href={`/cases?clientId=${c.id}`} className="mt-2 inline-block text-sm text-navy-soft underline">View cases</Link>
          </Card>
        ))}
      </div>
      {editing && (
        <Modal title={editing === 'new' ? 'New client' : 'Edit client'} onClose={() => setEditing(null)}>
          <form onSubmit={save} className="space-y-3">
            {err && <Alert>{err}</Alert>}
            <Field label="Name"><Input required value={form.name} onChange={set('name')} maxLength={200} /></Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Phone"><Input type="tel" value={form.phone} onChange={set('phone')} /></Field>
              <Field label="Email"><Input type="email" value={form.email} onChange={set('email')} /></Field>
            </div>
            <Field label="Address"><Textarea rows={2} value={form.address} onChange={set('address')} /></Field>
            <Field label="Notes" hint="Private to you."><Textarea rows={3} value={form.notes} onChange={set('notes')} /></Field>
            <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setEditing(null)}>Cancel</Button><Button disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button></div>
          </form>
        </Modal>
      )}
    </>
  );
}
