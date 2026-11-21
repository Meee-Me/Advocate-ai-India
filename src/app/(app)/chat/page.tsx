'use client';
import clsx from 'clsx';
import { Suspense, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { api, errorText, postStream, useApi } from '@/components/api';
import { askAiConsent } from '@/components/AiConsent';
import { Flags, type Flag } from '@/components/Flags';
import { Markdown } from '@/components/Markdown';
import { Alert, Button, Spinner, Textarea } from '@/components/ui';

interface Msg { id?: string; role: 'user' | 'assistant'; content: string; flags?: Flag[] }
interface Conv { id: string; title: string }

const STARTERS = ['Explain the grounds for anticipatory bail under the BNSS.', 'What are the essential ingredients of an offence under Section 138 of the Negotiable Instruments Act, 1881?', 'List the documents needed to file a suit for specific performance.'];

function Inner() {
  const caseId = useSearchParams().get('caseId');
  const convs = useApi<{ conversations: Conv[] }>('/api/conversations');
  const [active, setActive] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showList, setShowList] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [msgs]);

  const open = async (id: string | null) => {
    setActive(id); setErr(null); setShowList(false);
    if (!id) return setMsgs([]);
    const r = await api<{ messages: Msg[] }>(`/api/conversations/${id}`);
    setMsgs(r.messages);
  };
  const send = async (text: string) => {
    if (!text.trim() || busy) return;
    const c = await askAiConsent({ items: ['Your message', 'The earlier messages in this conversation'], hasCase: Boolean(caseId) || active !== null });
    if (!c) return;
    setBusy(true); setErr(null); setInput('');
    setMsgs((m) => [...m, { role: 'user', content: text }, { role: 'assistant', content: '' }]);
    try {
      await postStream('/api/chat', { message: text, conversationId: active ?? undefined, caseId: active ? undefined : caseId, ...c }, ({ event, data }) => {
        if (event === 'meta') setActive(data.conversationId);
        if (event === 'delta') setMsgs((m) => m.map((x, i) => (i === m.length - 1 ? { ...x, content: x.content + data.text } : x)));
        if (event === 'done') setMsgs((m) => m.map((x, i) => (i === m.length - 1 ? { ...x, id: data.messageId, content: data.text, flags: data.flags } : x)));
        if (event === 'error') { setErr(data.error); setMsgs((m) => m.filter((x, i) => !(i === m.length - 1 && !x.content))); }
      });
      convs.mutate();
    } catch (x) {
      setErr(errorText(x)); setMsgs((m) => m.slice(0, -2)); setInput(text);
    } finally { setBusy(false); }
  };
  const remove = async (id: string) => { if (!confirm('Delete this conversation?')) return; await api(`/api/conversations/${id}`, { method: 'DELETE' }); if (active === id) open(null); convs.mutate(); };

  const list = (
    <div className="space-y-1">
      <Button variant="secondary" className="mb-2 w-full" onClick={() => open(null)}>+ New conversation</Button>
      {convs.data?.conversations.map((c) => (
        <div key={c.id} className={clsx('group flex items-center rounded-lg', active === c.id ? 'bg-brass-soft' : 'hover:bg-brass-soft/60')}>
          <button className="min-h-10 flex-1 truncate px-2.5 text-left text-sm" onClick={() => open(c.id)}>{c.title}</button>
          <button aria-label={`Delete ${c.title}`} className="px-2 text-muted hover:text-danger" onClick={() => remove(c.id)}>✕</button>
        </div>
      ))}
    </div>
  );

  return (
    <div className="grid gap-4 md:grid-cols-[16rem_1fr]">
      <aside className="hidden md:block">{list}</aside>
      <section className="flex min-h-[70dvh] flex-col">
        <div className="mb-3 flex items-center justify-between md:hidden"><h1 className="text-2xl font-bold">Legal chat</h1><Button size="sm" variant="secondary" onClick={() => setShowList((v) => !v)}>History</Button></div>
        {showList && <div className="mb-3 rounded-xl border border-line bg-card p-2 md:hidden">{list}</div>}
        <h1 className="mb-1 hidden text-3xl font-bold md:block">Legal chat</h1>
        <p className="mb-3 text-sm text-muted">{caseId && !active ? 'This conversation will use your case details as context. ' : ''}Authorities the AI cites from memory are tagged <span className="font-medium text-warn">⚠️[unverified]</span> unless they appear in what you provided.</p>
        <div className="flex-1 space-y-4 pb-4" aria-live="polite">
          {!msgs.length && (
            <div className="grid gap-2 sm:grid-cols-3">{STARTERS.map((s) => <button key={s} onClick={() => send(s)} className="rounded-xl border border-line bg-card p-3 text-left text-sm hover:bg-brass-soft">{s}</button>)}</div>
          )}
          {msgs.map((m, i) => (
            <div key={i} className={clsx('rounded-xl border p-3 sm:p-4', m.role === 'user' ? 'ml-6 border-navy/10 bg-navy/5 sm:ml-16' : 'mr-1 border-line bg-card sm:mr-10')}>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">{m.role === 'user' ? 'You' : 'Advocate AI'}</p>
              {m.role === 'user' ? <p className="whitespace-pre-wrap text-sm">{m.content}</p> : m.content ? <Markdown>{m.content}</Markdown> : <Spinner label="Thinking…" />}
              {m.flags && <div className="mt-3"><Flags flags={m.flags} /></div>}
            </div>
          ))}
          <div ref={end} />
        </div>
        {err && <div className="mb-2"><Alert>{err}</Alert></div>}
        <form onSubmit={(e) => { e.preventDefault(); send(input); }} className="sticky bottom-0 -mx-3 flex gap-2 border-t border-line bg-paper px-3 py-3 sm:mx-0 sm:px-0">
          <Textarea rows={2} className="min-h-12 flex-1" value={input} maxLength={20000} placeholder="Ask about Indian law, or paste facts…" aria-label="Your question" disabled={busy}
            onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input); } }} />
          <Button disabled={busy || !input.trim()}>{busy ? '…' : 'Send'}</Button>
        </form>
      </section>
    </div>
  );
}
export default function Chat() { return <Suspense><Inner /></Suspense>; }
