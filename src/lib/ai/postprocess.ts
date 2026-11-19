import { guard, quoteInSource, type Flag } from '@/lib/legal/citation-guard';
import type { Contract, Judgment, Research } from './schemas';

/** All string values in a result, for scanning. */
function strings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => strings(v, out));
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => strings(v, out));
  return out;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const present = (needle: string, sources: string[]) => norm(needle).length > 0 && norm(sources.join('\n')).includes(norm(needle));

export type VerifiedResearch = Omit<Research, 'authorities'> & {
  authorities: (Research['authorities'][number] & { verified: boolean; downgraded: boolean })[];
};

/**
 * "provided_source" is only believed if the authority really appears in the supplied
 * material; otherwise it is downgraded to "model_memory". Nothing from model memory is
 * ever marked verified.
 */
export function verifyResearch(r: Research, sources: string[]): { result: VerifiedResearch; flags: Flag[] } {
  const authorities = r.authorities.map((a) => {
    const found = a.basis === 'provided_source' && present(a.name, sources);
    return { ...a, basis: found ? ('provided_source' as const) : ('model_memory' as const), verified: found, downgraded: a.basis === 'provided_source' && !found };
  });
  const { flags } = guard(strings({ ...r, authorities: [] }).join('\n'), sources, false);
  for (const a of authorities) {
    if (!a.verified && a.kind === 'case' && !flags.some((f) => f.text.includes(a.name))) {
      flags.push({ kind: 'case_name', text: a.name, note: 'From the AI\'s memory, not from your documents. Confirm it exists and says what is claimed before relying on it.' });
    }
  }
  return { result: { ...r, authorities }, flags };
}

export type VerifiedContract = Omit<Contract, 'risks'> & { risks: (Contract['risks'][number] & { quote_verified: boolean | null })[] };

/** Marks each quoted clause as found / not found in the contract text (null when the contract was read as a PDF image). */
export function verifyContract(c: Contract, source: string | null): VerifiedContract {
  return { ...c, risks: c.risks.map((r) => ({ ...r, quote_verified: source === null || !r.quote ? null : quoteInSource(r.quote, source) })) };
}

export type VerifiedJudgment = Omit<Judgment, 'key_quotes' | 'cases_cited_in_judgment'> & {
  key_quotes: (Judgment['key_quotes'][number] & { verified: boolean | null })[];
  cases_cited_in_judgment: (Judgment['cases_cited_in_judgment'][number] & { verified: boolean | null })[];
};

export function verifyJudgment(j: Judgment, source: string | null): VerifiedJudgment {
  return {
    ...j,
    key_quotes: j.key_quotes.map((q) => ({ ...q, verified: source === null ? null : quoteInSource(q.quote, source) })),
    cases_cited_in_judgment: j.cases_cited_in_judgment.map((c) => ({
      ...c,
      // A case "cited in the judgment" must literally be in the judgment.
      verified: source === null ? null : present(c.name, [source]) && (!c.citation || present(c.citation, [source])),
    })),
  };
}
