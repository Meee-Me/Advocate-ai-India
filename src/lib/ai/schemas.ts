import { z } from 'zod';

// Structured-output schemas. Every field is required (use nullable / empty arrays),
// which keeps the model's JSON schema simple and the stored results uniform.
const s = z.string();

export const researchSchema = z.object({
  restated_question: s,
  short_answer: s,
  issues: z.array(z.object({ issue: s, analysis: s })),
  provisions: z.array(z.object({ provision: s, relevance: s, confidence: z.enum(['high', 'medium', 'low']) })),
  authorities: z.array(z.object({
    name: s,
    kind: z.enum(['case', 'statute', 'rule', 'constitutional', 'other']),
    basis: z.enum(['provided_source', 'model_memory']),
    proposition: s,
    verify: s,
  })),
  arguments_for: z.array(s),
  arguments_against: z.array(s),
  practical_steps: z.array(s),
  missing_information: z.array(s),
  caveats: z.array(s),
});

export const summarySchema = z.object({
  title: s,
  document_type: s,
  summary: s,
  key_points: z.array(s),
  parties: z.array(z.object({ name: s, role: s })),
  important_dates: z.array(z.object({ date: s, event: s })),
  amounts: z.array(z.object({ amount: s, description: s })),
  action_items: z.array(s),
  open_questions: z.array(s),
});

export const contractSchema = z.object({
  contract_type: s,
  parties: z.array(z.object({ name: s, role: s })),
  effective_date: z.string().nullable(),
  term_and_renewal: z.string().nullable(),
  governing_law: z.string().nullable(),
  forum_or_arbitration: z.string().nullable(),
  summary: s,
  key_clauses: z.array(z.object({ clause_ref: z.string().nullable(), title: s, summary: s })),
  obligations: z.array(z.object({ party: s, obligation: s, deadline: z.string().nullable() })),
  risks: z.array(z.object({
    severity: z.enum(['high', 'medium', 'low']),
    clause_ref: z.string().nullable(),
    quote: z.string().nullable(),
    issue: s,
    why_it_matters: s,
    suggested_change: z.string().nullable(),
  })),
  missing_or_unusual: z.array(z.object({ item: s, why: s })),
  stamping_and_registration: s,
  limitations: z.array(s),
});

export const judgmentSchema = z.object({
  case_title: s,
  court: z.string().nullable(),
  bench: z.string().nullable(),
  case_number: z.string().nullable(),
  date_of_judgment: z.string().nullable(),
  background_facts: s,
  issues: z.array(s),
  arguments_petitioner: z.array(s),
  arguments_respondent: z.array(s),
  ratio_decidendi: s,
  obiter_dicta: z.string().nullable(),
  outcome: s,
  provisions_discussed: z.array(s),
  cases_cited_in_judgment: z.array(z.object({ name: s, citation: z.string().nullable(), how_used: s })),
  key_quotes: z.array(z.object({ quote: s, paragraph: z.string().nullable() })),
  practical_takeaways: z.array(s),
  limitations: z.array(s),
});

export const translationSchema = z.object({
  translation: s,
  glossary: z.array(z.object({ source: s, target: s, note: z.string().nullable() })),
  warnings: z.array(s),
});

export type Research = z.infer<typeof researchSchema>;
export type Summary = z.infer<typeof summarySchema>;
export type Contract = z.infer<typeof contractSchema>;
export type Judgment = z.infer<typeof judgmentSchema>;
export type Translation = z.infer<typeof translationSchema>;
