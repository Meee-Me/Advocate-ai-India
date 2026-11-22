'use client';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { api, errorText } from '@/components/api';
import { Button, Field, Input } from '@/components/ui';

type Mode = 'login' | 'register' | 'reset';

const COPY: Record<Mode, { title: string; button: string; path: string }> = {
  login: { title: 'Sign in', button: 'Sign in', path: '/api/auth/login' },
  register: { title: 'Create your account', button: 'Create account', path: '/api/auth/register' },
  reset: { title: 'Choose a new password', button: 'Save new password', path: '/api/auth/reset' },
};

/** One form for sign-in, sign-up, and "set new password". All calls go to this site's own /api/auth routes. */
export function AuthForm({ mode, next = '/dashboard', notice }: { mode: Mode; next?: string; notice?: string }) {
  const c = COPY[mode];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const v = (k: string) => String(f.get(k) ?? '');
    const body = {
      login: { username: v('username'), password: v('password'), remember: f.get('remember') === 'on', next },
      register: { fullName: v('fullName'), username: v('username'), password: v('password'), confirmPassword: v('confirmPassword'), acknowledged: f.get('acknowledged') === 'on' },
      reset: { password: v('password'), confirmPassword: v('confirmPassword') },
    }[mode];
    // The form has noValidate (so our own messages show), which also switches off the browser's "required" check,
    // so the sign-up warning is checked here. The server checks it as well.
    if (mode === 'register' && f.get('acknowledged') !== 'on') { setError('Please tick the box to confirm you understand.'); return; }
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ next?: string; signedIn?: boolean }>(c.path, { body });
      if (mode === 'login' || (mode === 'register' && r.signedIn)) window.location.assign(r.next ?? '/dashboard');
      else window.location.assign('/dashboard');
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  const pw = mode === 'register' || mode === 'reset';
  return (
    <main className="grid min-h-dvh place-items-center px-4 py-8">
      <div className="w-full max-w-md rounded-2xl border border-line bg-card p-6 shadow-sm sm:p-8">
        <p className="text-center font-serif text-2xl font-bold">⚖ Advocate AI <span className="text-brass">India</span></p>
        <h1 className="mt-4 text-center text-lg font-semibold">{c.title}</h1>
        {notice && <p role="status" className="mt-4 rounded-lg border border-line bg-brass-soft px-3 py-2 text-sm">{notice}</p>}
        {done ? (
          <p role="status" className="mt-5 rounded-lg border border-line bg-brass-soft px-3 py-3 text-sm">{done}</p>
        ) : (
          <form onSubmit={submit} className="mt-5 space-y-4" noValidate>
            {mode === 'register' && <Field label="Full name"><Input name="fullName" autoComplete="name" required /></Field>}
            {mode !== 'reset' && <Field label="Username" hint={mode === 'register' ? '3 to 30 letters, numbers, dots, dashes or underscores. You will use it to sign in.' : undefined}><Input name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} required /></Field>}
            {(
              <Field label={mode === 'reset' ? 'New password' : 'Password'} hint={pw ? 'At least 10 characters, with a letter and a number.' : undefined}>
                <Input name="password" type="password" autoComplete={pw ? 'new-password' : 'current-password'} required />
              </Field>
            )}
            {pw && <Field label="Confirm password"><Input name="confirmPassword" type="password" autoComplete="new-password" required /></Field>}
            {mode === 'register' && (
              <>
                <p className="rounded-lg border border-line bg-brass-soft/60 px-3 py-2 text-xs text-muted">
                  Your data is currently stored on our servers without extra encryption by the app. Please do not enter real client information yet.
                </p>
                <label className="flex items-start gap-2 text-sm">
                  <input type="checkbox" name="acknowledged" required className="mt-1 size-4" />
                  <span><strong>Keep your sign-in details safe.</strong> There is no email on this account, so a forgotten password cannot be reset by you. Please write it down safely; the administrator can help if you lose it. <span className="font-medium">I understand.</span></span>
                </label>
              </>
            )}
            {mode === 'login' && <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" name="remember" className="size-4" /> Keep me signed in on this device</label>}
            {error && <p role="alert" className="rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
            <Button type="submit" disabled={busy} className="w-full">{busy ? 'Please wait…' : c.button}</Button>
          </form>
        )}
        <p className="mt-5 flex flex-wrap justify-center gap-x-4 gap-y-1 text-sm text-muted">
          {mode === 'login' && <><Link className="underline" href="/register">Create an account</Link></>}
          {mode !== 'login' && <Link className="underline" href="/login">Back to sign in</Link>}
          <Link className="underline" href="/">About this site</Link>
        </p>
      </div>
    </main>
  );
}
