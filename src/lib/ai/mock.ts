import type { RunInput, RunResult, StreamEvent } from './client';

/**
 * Canned answers for local development and automated tests (AI_PROVIDER=mock).
 * They deliberately include an authority that is NOT in any supplied material, so the
 * citation guard has something to flag end to end.
 */
const lastUser = (input: RunInput): string => {
  const m = [...input.messages].reverse().find((x) => x.role === 'user');
  if (!m) return '';
  return typeof m.content === 'string' ? m.content : m.content.map((b) => ('text' in b ? b.text : '')).join('\n');
};

const result = (input: RunInput, text: string): RunResult => ({ text, model: 'mock', inputTokens: 10, outputTokens: Math.ceil(text.length / 4), truncated: false });

export async function* mockStream(input: RunInput): AsyncGenerator<StreamEvent> {
  const user = lastUser(input);
  let text: string;
  if (input.kind === 'edit') {
    const doc = /DOCUMENT:\n([\s\S]*?)\n\nINSTRUCTION:/.exec(user)?.[1] ?? '';
    text = `${doc}\n\n(revised by mock)`;
  } else if (input.kind === 'draft') {
    text = `# LEGAL NOTICE\n\nTo,\n[NAME OF RECIPIENT]\n\n1. That my client, [●], instructs me to state as follows.\n\n2. Under the Indian Contract Act, 1872 you are bound to perform.\n\nAdvocate`;
  } else {
    text = `Mock answer to: ${user.slice(0, 120)}\n\nThis was held in Kesavananda Bharati v. State of Kerala, AIR 1973 SC 1461.`;
  }
  for (const word of text.split(/(?<= )/)) yield { type: 'delta', text: word };
  yield { type: 'done', result: result(input, text) };
}

const FIXTURES: Record<string, unknown> = {
  research: {
    restated_question: 'Mock question',
    short_answer: 'Mock short answer.',
    issues: [{ issue: 'Issue 1', analysis: 'Analysis 1' }],
    provisions: [{ provision: 'Section 138, Negotiable Instruments Act, 1881', relevance: 'Dishonour of cheque', confidence: 'high' }],
    authorities: [
      { name: 'Kesavananda Bharati v. State of Kerala', kind: 'case', basis: 'provided_source', proposition: 'Basic structure', verify: 'Check the report' },
      { name: 'Negotiable Instruments Act, 1881', kind: 'statute', basis: 'model_memory', proposition: 'Cheque dishonour', verify: 'India Code' },
    ],
    arguments_for: ['For'], arguments_against: ['Against'], practical_steps: ['Step'], missing_information: ['Facts'], caveats: ['Mock'],
  },
  summary: {
    title: 'Mock summary', document_type: 'Order', summary: 'Mock summary text.', key_points: ['Point'],
    parties: [{ name: 'A', role: 'Petitioner' }], important_dates: [{ date: '2024-01-01', event: 'Filed' }], amounts: [], action_items: ['Do'], open_questions: [],
  },
  contract: {
    contract_type: 'Mock agreement', parties: [{ name: 'A', role: 'Seller' }], effective_date: null, term_and_renewal: null, governing_law: 'Laws of India', forum_or_arbitration: null,
    summary: 'Mock', key_clauses: [{ clause_ref: '1', title: 'Term', summary: 'x' }], obligations: [{ party: 'A', obligation: 'Deliver', deadline: null }],
    risks: [
      { severity: 'high', clause_ref: '7', quote: 'the Seller shall indemnify without limit', issue: 'Unlimited indemnity', why_it_matters: 'Exposure', suggested_change: 'Cap it' },
      { severity: 'low', clause_ref: '9', quote: 'text that is not in the contract', issue: 'Fabricated', why_it_matters: 'x', suggested_change: null },
    ],
    missing_or_unusual: [], stamping_and_registration: 'Confirm State stamp duty.', limitations: [],
  },
  judgment: {
    case_title: 'Mock v. Mock', court: null, bench: null, case_number: null, date_of_judgment: null, background_facts: 'Facts', issues: ['Issue'],
    arguments_petitioner: [], arguments_respondent: [], ratio_decidendi: 'Ratio', obiter_dicta: null, outcome: 'Allowed', provisions_discussed: [],
    cases_cited_in_judgment: [{ name: 'Real v. Cited', citation: '(2001) 1 SCC 1', how_used: 'Followed' }, { name: 'Invented v. Case', citation: 'AIR 1999 SC 999', how_used: 'Followed' }],
    key_quotes: [{ quote: 'justice delayed is justice denied', paragraph: '5' }, { quote: 'a sentence that never appears in the judgment', paragraph: '6' }],
    practical_takeaways: [], limitations: [],
  },
  translation: { translation: '[mock translation]', glossary: [], warnings: [] },
};

export function mockStructured(input: RunInput): RunResult {
  const data = FIXTURES[input.kind];
  if (!data) throw new Error(`No mock fixture for ${input.kind}`);
  const base = JSON.parse(JSON.stringify(data));
  if (input.kind === 'translation') base.translation = `[mock translation] ${lastUser(input).slice(0, 80)}`;
  return result(input, JSON.stringify(base));
}
