'use client';
import { Flags, Verified, type Flag } from './Flags';
import { Badge, Card } from './ui';

/* eslint-disable @typescript-eslint/no-explicit-any */
const List = ({ items }: { items?: string[] }) => (items?.length ? <ul className="list-disc space-y-1 pl-5 text-sm">{items.map((x, i) => <li key={i}>{x}</li>)}</ul> : <p className="text-sm text-muted">None.</p>);
const Section = ({ title, children }: { title: string; children: React.ReactNode }) => <Card><h3 className="mb-2 text-lg font-bold">{title}</h3>{children}</Card>;
const sev = (s: string) => (s === 'high' ? 'danger' : s === 'medium' ? 'warn' : 'neutral') as 'danger' | 'warn' | 'neutral';

export function ResearchView({ r, flags }: { r: any; flags?: Flag[] }) {
  return (
    <div className="space-y-4">
      <Flags flags={flags} />
      <Section title="Short answer"><p className="whitespace-pre-wrap text-sm">{r.short_answer}</p></Section>
      <Section title="Issues">{r.issues.map((x: any, i: number) => <div key={i} className="mb-3 text-sm"><p className="font-semibold">{x.issue}</p><p className="whitespace-pre-wrap">{x.analysis}</p></div>)}</Section>
      <Section title="Provisions">
        {r.provisions.length ? r.provisions.map((p: any, i: number) => <div key={i} className="mb-2 text-sm"><p className="font-medium">{p.provision} <Badge tone={p.confidence === 'high' ? 'ok' : p.confidence === 'low' ? 'warn' : 'neutral'}>{p.confidence} confidence</Badge></p><p className="text-muted">{p.relevance}</p></div>) : <p className="text-sm text-muted">None identified.</p>}
      </Section>
      <Section title="Authorities">
        {r.authorities.length ? r.authorities.map((a: any, i: number) => (
          <div key={i} className="mb-3 text-sm"><p className="font-medium">{a.name} <Badge>{a.kind}</Badge> {a.verified ? <Badge tone="ok">from your materials</Badge> : <Badge tone="warn">AI memory: verify</Badge>}</p>
            <p>{a.proposition}</p><p className="text-xs text-muted">Check: {a.verify}</p>{a.downgraded && <p className="text-xs text-danger">The AI said this came from your materials, but it was not found there.</p>}</div>
        )) : <p className="text-sm text-muted">No authorities cited. Locate supporting case law on an official or licensed database.</p>}
      </Section>
      <div className="grid gap-4 md:grid-cols-2"><Section title="Arguments for"><List items={r.arguments_for} /></Section><Section title="Arguments against"><List items={r.arguments_against} /></Section></div>
      <div className="grid gap-4 md:grid-cols-2"><Section title="Practical steps"><List items={r.practical_steps} /></Section><Section title="Information still needed"><List items={r.missing_information} /></Section></div>
      <Section title="Caveats"><List items={r.caveats} /></Section>
    </div>
  );
}

export function SummaryView({ r }: { r: any }) {
  return (
    <div className="space-y-4">
      <Section title={r.title}><p className="mb-1"><Badge tone="brass">{r.document_type}</Badge></p><p className="whitespace-pre-wrap text-sm">{r.summary}</p></Section>
      <div className="grid gap-4 md:grid-cols-2">
        <Section title="Key points"><List items={r.key_points} /></Section>
        <Section title="Action items"><List items={r.action_items} /></Section>
        <Section title="Parties">{r.parties.length ? <ul className="space-y-1 text-sm">{r.parties.map((p: any, i: number) => <li key={i}>{p.name} <span className="text-muted">({p.role})</span></li>)}</ul> : <p className="text-sm text-muted">None.</p>}</Section>
        <Section title="Dates & amounts"><ul className="space-y-1 text-sm">{r.important_dates.map((d: any, i: number) => <li key={i}><b>{d.date}</b>: {d.event}</li>)}{r.amounts.map((a: any, i: number) => <li key={`a${i}`}><b>{a.amount}</b>: {a.description}</li>)}</ul></Section>
      </div>
      {!!r.open_questions.length && <Section title="Open questions"><List items={r.open_questions} /></Section>}
    </div>
  );
}

export function ContractView({ r, flags }: { r: any; flags?: Flag[] }) {
  return (
    <div className="space-y-4">
      <Flags flags={flags} />
      <Section title={r.contract_type}>
        <p className="whitespace-pre-wrap text-sm">{r.summary}</p>
        <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">{[['Effective date', r.effective_date], ['Term & renewal', r.term_and_renewal], ['Governing law', r.governing_law], ['Forum / arbitration', r.forum_or_arbitration]].filter(([, v]) => v).map(([k, v]) => <div key={k as string}><dt className="text-xs text-muted">{k}</dt><dd>{v}</dd></div>)}</dl>
      </Section>
      <Section title="Risks">
        {r.risks.length ? r.risks.map((x: any, i: number) => (
          <div key={i} className="mb-4 border-b border-line pb-3 text-sm last:border-0"><p className="font-semibold"><Badge tone={sev(x.severity)}>{x.severity}</Badge> {x.clause_ref && <span className="text-muted">Clause {x.clause_ref}: </span>}{x.issue}</p>
            {x.quote && <blockquote className="mt-1 border-l-2 border-brass pl-2 italic">“{x.quote}” <Verified v={x.quote_verified} /></blockquote>}
            <p className="mt-1">{x.why_it_matters}</p>{x.suggested_change && <p className="mt-1 text-ok"><b>Suggestion:</b> {x.suggested_change}</p>}</div>
        )) : <p className="text-sm text-muted">No significant risks identified.</p>}
      </Section>
      <div className="grid gap-4 md:grid-cols-2">
        <Section title="Key clauses">{r.key_clauses.map((c: any, i: number) => <p key={i} className="mb-2 text-sm"><b>{c.clause_ref ? `${c.clause_ref}. ` : ''}{c.title}</b>: {c.summary}</p>)}</Section>
        <Section title="Obligations">{r.obligations.map((o: any, i: number) => <p key={i} className="mb-2 text-sm"><b>{o.party}</b>: {o.obligation}{o.deadline ? ` (by ${o.deadline})` : ''}</p>)}</Section>
      </div>
      <Section title="Missing or unusual terms">{r.missing_or_unusual.length ? r.missing_or_unusual.map((m: any, i: number) => <p key={i} className="mb-2 text-sm"><b>{m.item}</b>: {m.why}</p>) : <p className="text-sm text-muted">None noted.</p>}</Section>
      <Section title="Stamping & registration"><p className="text-sm">{r.stamping_and_registration}</p></Section>
      {!!r.limitations.length && <Section title="Limits of this review"><List items={r.limitations} /></Section>}
    </div>
  );
}

export function JudgmentView({ r, flags }: { r: any; flags?: Flag[] }) {
  return (
    <div className="space-y-4">
      <Flags flags={flags} />
      <Section title={r.case_title}>
        <p className="text-sm text-muted">{[r.court, r.bench, r.case_number, r.date_of_judgment].filter(Boolean).join(' · ')}</p>
        <h4 className="mt-3 font-semibold">Facts</h4><p className="whitespace-pre-wrap text-sm">{r.background_facts}</p>
      </Section>
      <div className="grid gap-4 md:grid-cols-2"><Section title="Issues"><List items={r.issues} /></Section><Section title="Outcome"><p className="whitespace-pre-wrap text-sm">{r.outcome}</p></Section></div>
      <div className="grid gap-4 md:grid-cols-2"><Section title="Petitioner's arguments"><List items={r.arguments_petitioner} /></Section><Section title="Respondent's arguments"><List items={r.arguments_respondent} /></Section></div>
      <Section title="Ratio decidendi"><p className="whitespace-pre-wrap text-sm">{r.ratio_decidendi}</p>{r.obiter_dicta && <><h4 className="mt-3 font-semibold">Obiter</h4><p className="whitespace-pre-wrap text-sm">{r.obiter_dicta}</p></>}</Section>
      <Section title="Provisions discussed"><List items={r.provisions_discussed} /></Section>
      <Section title="Cases cited in the judgment">
        {r.cases_cited_in_judgment.length ? r.cases_cited_in_judgment.map((c: any, i: number) => <p key={i} className="mb-2 text-sm"><b>{c.name}</b>{c.citation ? `, ${c.citation}` : ''} <Verified v={c.verified} /><br /><span className="text-muted">{c.how_used}</span></p>) : <p className="text-sm text-muted">None.</p>}
      </Section>
      <Section title="Key quotes">
        {r.key_quotes.length ? r.key_quotes.map((q: any, i: number) => <blockquote key={i} className="mb-2 border-l-2 border-brass pl-2 text-sm italic">“{q.quote}” {q.paragraph && <span className="not-italic text-muted">(para {q.paragraph})</span>} <Verified v={q.verified} /></blockquote>) : <p className="text-sm text-muted">None.</p>}
      </Section>
      <Section title="Takeaways"><List items={r.practical_takeaways} /></Section>
      {!!r.limitations.length && <Section title="Limits of this analysis"><List items={r.limitations} /></Section>}
    </div>
  );
}

export function AnalysisView({ kind, result, flags }: { kind: string; result: any; flags?: Flag[] }) {
  if (kind === 'contract') return <ContractView r={result} flags={flags} />;
  if (kind === 'judgment') return <JudgmentView r={result} flags={flags} />;
  if (kind === 'research') return <ResearchView r={result} flags={flags ?? result.flags} />;
  return <><Flags flags={flags} /><SummaryView r={result} /></>;
}
