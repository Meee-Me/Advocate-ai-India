'use client';
import { useState } from 'react';
import { api, errorText, toLocalInput, useApi } from './api';
import { Alert, Button, Field, Input, Modal, Select, Textarea } from './ui';

export interface Hearing {
  id: string; caseId: string; hearingAt: string; purpose: string | null; court: string | null; courtroom: string | null; itemNumber?: string | null; bench?: string | null; assignedTo?: string | null; assignedName?: string | null;
  status: string; notes: string | null; remindBeforeMinutes: number; caseTitle?: string;
}
const REMIND = [[0, 'At the time'], [60, '1 hour before'], [180, '3 hours before'], [1440, '1 day before'], [2880, '2 days before'], [10080, '1 week before']] as const;

export function HearingModal({ hearing, caseId, onClose, onSaved }: { hearing?: Hearing; caseId?: string; onClose: () => void; onSaved: () => void }) {
  const cases = useApi<{ cases: { id: string; title: string }[] }>(caseId || hearing ? null : '/api/cases?limit=200');
  const office = useApi<{ assignable: { id: string; name: string }[] }>('/api/office');
  const [f, setF] = useState({
    caseId: hearing?.caseId ?? caseId ?? '',
    hearingAt: toLocalInput(hearing?.hearingAt ?? new Date(Date.now() + 864e5)),
    purpose: hearing?.purpose ?? '', court: hearing?.court ?? '', courtroom: hearing?.courtroom ?? '', itemNumber: hearing?.itemNumber ?? '', bench: hearing?.bench ?? '', assignedTo: hearing?.assignedTo ?? '',
    status: hearing?.status ?? 'scheduled', notes: hearing?.notes ?? '', remindBeforeMinutes: hearing?.remindBeforeMinutes ?? 1440,
  });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try {
      const body = { ...f, hearingAt: new Date(f.hearingAt).toISOString(), remindBeforeMinutes: Number(f.remindBeforeMinutes) };
      if (hearing) { const { caseId: _c, ...patch } = body; void _c; await api(`/api/hearings/${hearing.id}`, { method: 'PATCH', body: patch }); }
      else await api('/api/hearings', { body });
      onSaved(); onClose();
    } catch (x) { setErr(errorText(x)); } finally { setBusy(false); }
  };
  const remove = async () => {
    if (!hearing || !confirm('Delete this hearing?')) return;
    await api(`/api/hearings/${hearing.id}`, { method: 'DELETE' }); onSaved(); onClose();
  };
  return (
    <Modal title={hearing ? 'Edit hearing' : 'Add hearing'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        {err && <Alert>{err}</Alert>}
        {!caseId && !hearing && (
          <Field label="Case"><Select required value={f.caseId} onChange={set('caseId')}><option value="">Choose a case…</option>{cases.data?.cases.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}</Select></Field>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Date and time"><Input type="datetime-local" required value={f.hearingAt} onChange={set('hearingAt')} /></Field>
          <Field label="Remind me"><Select value={f.remindBeforeMinutes} onChange={set('remindBeforeMinutes')}>{REMIND.map(([m, l]) => <option key={m} value={m}>{l}</option>)}</Select></Field>
          <Field label="Purpose"><Input value={f.purpose} onChange={set('purpose')} placeholder="Arguments, evidence…" /></Field>
          <Field label="Status"><Select value={f.status} onChange={set('status')}>{['scheduled', 'completed', 'adjourned', 'cancelled'].map((s) => <option key={s}>{s}</option>)}</Select></Field>
          <Field label="Court"><Input value={f.court} onChange={set('court')} /></Field>
          <Field label="Courtroom"><Input value={f.courtroom} onChange={set('courtroom')} /></Field>
          <Field label="Item number" hint="As printed in the cause list."><Input value={f.itemNumber} onChange={set('itemNumber')} inputMode="numeric" /></Field>
          <Field label="Bench"><Input value={f.bench} onChange={set('bench')} /></Field>
          {(office.data?.assignable.length ?? 0) > 1 && (
            <Field label="Covered by" hint="Who attends this hearing."><Select value={f.assignedTo} onChange={set('assignedTo')}><option value="">Not assigned</option>{office.data?.assignable.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
          )}
        </div>
        <Field label="Notes / outcome"><Textarea rows={3} value={f.notes} onChange={set('notes')} /></Field>
        <div className="flex justify-between gap-2">
          {hearing ? <Button type="button" variant="danger" onClick={remove}>Delete</Button> : <span />}
          <div className="flex gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button></div>
        </div>
      </form>
    </Modal>
  );
}
