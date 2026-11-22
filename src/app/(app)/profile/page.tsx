'use client';
import { useEffect, useState } from 'react';
import { api, errorText, useApi } from '@/components/api';
import { Alert, Button, Card, Field, Input, PageHeader, Select, Spinner, Textarea } from '@/components/ui';
import { LANGUAGES } from '@/lib/validation';

interface Adv { displayName: string; email: string | null; enrolmentNumber: string | null; barCouncil: string | null; phone: string | null; city: string | null; state: string | null; bio: string | null; practiceAreas: string[]; courts: string[]; languages: string[]; preferredLanguage: string }
const list = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);

interface AiTest { ok: boolean; provider: string; model: string; latencyMs: number; reply: string; real: boolean }

function AiConnection() {
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<AiTest | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const run = async () => {
    setBusy(true); setErr(null); setRes(null);
    try { setRes(await api<AiTest>('/api/ai/test', { method: 'POST', body: {} })); } catch (x) { setErr(errorText(x)); } finally { setBusy(false); }
  };
  return (
    <Card className="mt-6 max-w-3xl space-y-3">
      <h2 className="text-lg font-bold">AI connection</h2>
      <p className="text-sm text-muted">Sends one tiny real request to the configured AI provider and shows which provider and model answered. It uses one request from the shared plan limit.</p>
      <Button type="button" variant="secondary" onClick={run} disabled={busy}>{busy ? 'Testing…' : 'Test AI connection'}</Button>
      {err && <Alert>{err}</Alert>}
      {res && (res.real
        ? <Alert tone="ok">Real AI answered. Provider: <b>{res.provider}</b>, model: <b>{res.model}</b>, {res.latencyMs} ms, reply: “{res.reply}”.</Alert>
        : <Alert tone="warn">This is the <b>mock</b>, not a real AI. Set AI_PROVIDER (sambanova, ollama or anthropic) and that provider&apos;s API key.</Alert>)}
    </Card>
  );
}

export default function Profile() {
  const { data, mutate } = useApi<{ advocate: Adv }>('/api/profile');
  const [f, setF] = useState<Record<string, string | string[]> | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    if (data && !f) { const a = data.advocate; setF({ displayName: a.displayName, enrolmentNumber: a.enrolmentNumber ?? '', barCouncil: a.barCouncil ?? '', phone: a.phone ?? '', city: a.city ?? '', state: a.state ?? '', bio: a.bio ?? '', practiceAreas: a.practiceAreas.join(', '), courts: a.courts.join(', '), languages: a.languages, preferredLanguage: a.preferredLanguage }); }
  }, [data, f]);
  if (!f || !data) return <Spinner label="Loading profile…" />;
  const s = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setMsg(null);
    try {
      await api('/api/profile', { method: 'PATCH', body: { ...f, practiceAreas: list(String(f.practiceAreas)), courts: list(String(f.courts)) } });
      setMsg({ ok: true, text: 'Profile saved.' }); mutate();
    } catch (x) { setMsg({ ok: false, text: errorText(x) }); }
  };
  const toggleLang = (l: string) => { const cur = f.languages as string[]; setF({ ...f, languages: cur.includes(l) ? cur.filter((x) => x !== l) : [...cur, l] }); };
  return (
    <>
      <PageHeader title="Advocate profile" subtitle="Your sign-in is your email and password. The rest is stored only for you." />
      <form onSubmit={save} className="max-w-3xl space-y-5">
        <Card className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name" hint={data.advocate.email ?? undefined}><Input value={String(f.displayName)} onChange={s('displayName')} required /></Field>
            <Field label="Phone"><Input type="tel" value={String(f.phone)} onChange={s('phone')} /></Field>
            <Field label="Bar Council enrolment no."><Input value={String(f.enrolmentNumber)} onChange={s('enrolmentNumber')} placeholder="D/1234/2015" /></Field>
            <Field label="State Bar Council"><Input value={String(f.barCouncil)} onChange={s('barCouncil')} /></Field>
            <Field label="City"><Input value={String(f.city)} onChange={s('city')} /></Field>
            <Field label="State"><Input value={String(f.state)} onChange={s('state')} /></Field>
          </div>
          <Field label="About"><Textarea rows={3} value={String(f.bio)} onChange={s('bio')} maxLength={2000} /></Field>
        </Card>
        <Card className="space-y-3">
          <Field label="Practice areas" hint="Comma-separated, e.g. Criminal, Civil, Family"><Input value={String(f.practiceAreas)} onChange={s('practiceAreas')} /></Field>
          <Field label="Courts" hint="Comma-separated, e.g. Delhi High Court, Saket District Court"><Input value={String(f.courts)} onChange={s('courts')} /></Field>
          <fieldset><legend className="mb-1 text-sm font-medium">Languages you work in</legend>
            <div className="flex flex-wrap gap-2">{LANGUAGES.map((l) => (
              <label key={l} className="flex min-h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-line bg-white px-2.5 text-sm capitalize"><input type="checkbox" checked={(f.languages as string[]).includes(l)} onChange={() => toggleLang(l)} />{l}</label>))}</div></fieldset>
          <Field label="Preferred language for translation" className="max-w-xs"><Select value={String(f.preferredLanguage)} onChange={s('preferredLanguage')}>{LANGUAGES.map((l) => <option key={l} value={l} className="capitalize">{l}</option>)}</Select></Field>
        </Card>
        {msg && <Alert tone={msg.ok ? 'ok' : 'danger'}>{msg.text}</Alert>}
        <Button>Save profile</Button>
      </form>
      <AiConnection />
    </>
  );
}
