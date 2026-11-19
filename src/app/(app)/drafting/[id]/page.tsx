'use client';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, errorText, fmtDateTime, useApi } from '@/components/api';
import { Flags, type Flag } from '@/components/Flags';
import { Markdown } from '@/components/Markdown';
import { Alert, Button, Card, Field, Input, Spinner, Textarea } from '@/components/ui';

interface Draft { id: string; title: string; content: string; docType: string; language: string }
interface Version { id: string; note: string | null; createdAt: string; chars: number }
const PRESETS = ['Make the language more formal', 'Shorten without losing any fact', 'Add a prayer clause', 'Simplify the language', 'Fix grammar and numbering'];

export default function DraftEditor() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data, mutate } = useApi<{ draft: Draft; versions: Version[] }>(`/api/drafts/${id}`);
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [dirty, setDirty] = useState(false);
  const [preview, setPreview] = useState(false);
  const [instruction, setInstruction] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'danger'; text: string } | null>(null);
  const [flags, setFlags] = useState<Flag[]>([]);

  useEffect(() => { if (data && !dirty) { setTitle(data.draft.title); setText(data.draft.content); } }, [data, dirty]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (dirty) e.preventDefault(); };
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  if (!data) return <Spinner label="Loading draft…" />;

  const save = async () => {
    setBusy('save'); setMsg(null);
    try { await api(`/api/drafts/${id}`, { method: 'PATCH', body: { title, content: text } }); setDirty(false); await mutate(); setMsg({ tone: 'ok', text: 'Saved.' }); }
    catch (x) { setMsg({ tone: 'danger', text: errorText(x) }); } finally { setBusy(null); }
  };
  const aiEdit = async (inst: string) => {
    if (dirty) await save();
    setBusy('ai'); setMsg(null);
    try {
      const r = await api<{ draft: Draft; flags: Flag[] }>(`/api/drafts/${id}/edit`, { body: { instruction: inst } });
      setText(r.draft.content); setFlags(r.flags); setInstruction(''); setDirty(false); await mutate();
      setMsg({ tone: 'ok', text: 'Edited. The previous text is saved under Versions if you want it back.' });
    } catch (x) { setMsg({ tone: 'danger', text: errorText(x) }); } finally { setBusy(null); }
  };
  const restore = async (versionId: string) => {
    if (!confirm('Restore this earlier version? Your current text is kept as a version too.')) return;
    const r = await api<{ draft: Draft }>(`/api/drafts/${id}/restore`, { body: { versionId } });
    setText(r.draft.content); setDirty(false); mutate();
  };
  const del = async () => { if (confirm('Delete this draft and its history?')) { await api(`/api/drafts/${id}`, { method: 'DELETE' }); router.push('/drafting'); } };
  const download = () => {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: `${title || 'draft'}.md` }); a.click(); URL.revokeObjectURL(url);
  };

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2 no-print">
        <Input aria-label="Draft title" className="min-w-0 flex-1 font-serif text-lg font-bold" value={title} onChange={(e) => { setTitle(e.target.value); setDirty(true); }} />
        <Button onClick={save} disabled={!dirty || busy === 'save'}>{busy === 'save' ? 'Saving…' : dirty ? 'Save' : 'Saved'}</Button>
        <Button variant="secondary" onClick={() => setPreview((v) => !v)}>{preview ? 'Edit' : 'Preview'}</Button>
        <Button variant="secondary" onClick={() => window.print()}>Print</Button>
        <Button variant="secondary" onClick={download}>Download</Button>
        <Button variant="danger" onClick={del}>Delete</Button>
      </div>
      {msg && <div className="mb-3"><Alert tone={msg.tone}>{msg.text}</Alert></div>}
      <div className="grid gap-5 lg:grid-cols-[1fr_20rem]">
        <div>
          {preview ? <Card><Markdown>{text}</Markdown></Card>
            : <Textarea aria-label="Draft text" rows={28} className="font-serif text-[15px]" value={text} onChange={(e) => { setText(e.target.value); setDirty(true); }} spellCheck />}
          <div className="mt-3"><Flags flags={flags} /></div>
        </div>
        <aside className="space-y-4 no-print">
          <Card>
            <h2 className="mb-2 font-bold">Edit with AI</h2>
            <div className="mb-2 flex flex-wrap gap-1.5">{PRESETS.map((p) => <button key={p} disabled={!!busy} onClick={() => aiEdit(p)} className="rounded-full border border-line bg-white px-2.5 py-1 text-xs hover:bg-brass-soft disabled:opacity-50">{p}</button>)}</div>
            <Field label="Or say what to change"><Textarea rows={3} value={instruction} onChange={(e) => setInstruction(e.target.value)} placeholder="e.g. Add a clause allowing 15 days to comply" maxLength={4000} /></Field>
            <Button className="mt-2 w-full" disabled={!!busy || instruction.trim().length < 3} onClick={() => aiEdit(instruction)}>{busy === 'ai' ? 'Editing…' : 'Apply'}</Button>
            <p className="mt-2 text-xs text-muted">Placeholders like [●] mark facts you still need to fill in.</p>
          </Card>
          <Card>
            <h2 className="mb-2 font-bold">Versions</h2>
            {data.versions.length ? <ul className="space-y-2 text-sm">{data.versions.map((v) => (
              <li key={v.id} className="flex items-start justify-between gap-2"><div><p>{v.note ?? 'Earlier version'}</p><p className="text-xs text-muted">{fmtDateTime(v.createdAt)} · {v.chars} chars</p></div><Button size="sm" variant="ghost" onClick={() => restore(v.id)}>Restore</Button></li>))}</ul> : <p className="text-sm text-muted">Earlier versions appear here after each change.</p>}
          </Card>
        </aside>
      </div>
    </>
  );
}
