import Link from 'next/link';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { hasAuthCookie } from '@/lib/auth/supabase';

const FEATURES = [
  ['Legal chat', 'Ask questions on Indian law and get structured, practical answers.'],
  ['Research', 'Issue-by-issue memos that separate what comes from your documents from what the AI only remembers.'],
  ['Drafting', 'Notices, petitions, affidavits and agreements with placeholders, never invented facts, and full edit history.'],
  ['PDF analysis', 'Upload judgments, orders and contracts; get summaries and risk analysis with quotes checked against the text.'],
  ['Cases & clients', 'One place for matters, notes, documents and drafts.'],
  ['Hearing calendar', 'Reminders before every date, plus a calendar export for your phone.'],
  ['Translation', 'Between English and 12 Indian languages, with a glossary of legal terms.'],
] as const;

export default async function Home() {
  if (hasAuthCookie((await cookies()).getAll().map((c) => c.name))) redirect('/dashboard');
  return (
    <main>
      <section className="bg-navy px-4 py-16 text-white sm:py-24">
        <div className="mx-auto max-w-4xl text-center">
          <p className="font-serif text-sm uppercase tracking-widest text-brass">For advocates practising in India</p>
          <h1 className="mt-3 text-4xl font-bold sm:text-5xl">Advocate AI India</h1>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-white/80">Research, drafting, document analysis and case management in one place, built to never present an unchecked authority as fact.</p>
          <div className="mt-8 flex flex-wrap justify-center gap-3"><Link href="/login" className="inline-flex min-h-12 items-center rounded-lg bg-brass px-6 font-semibold text-white hover:opacity-90">Sign in</Link><Link href="/register" className="inline-flex min-h-12 items-center rounded-lg border border-white/40 px-6 font-semibold text-white hover:bg-white/10">Create account</Link></div>
        </div>
      </section>
      <section className="mx-auto grid max-w-5xl gap-4 px-4 py-12 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map(([t, d]) => (
          <div key={t} className="rounded-xl border border-line bg-card p-5"><h2 className="font-serif text-lg font-bold">{t}</h2><p className="mt-1 text-sm text-muted">{d}</p></div>
        ))}
      </section>
      <p className="mx-auto max-w-3xl px-4 pb-12 text-center text-xs text-muted">AI output can be wrong or out of date and is not legal advice. Verify every statute, case and citation before relying on it.</p>
    </main>
  );
}
