import { z } from 'zod';

/** Shared input rules. Every string has a maximum so no request can be unbounded. */
export const text = (max: number) => z.string().trim().max(max);
export const optText = (max: number) =>
  z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), z.string().trim().max(max).nullable().optional());
export const dateOnly = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD.').nullable().optional(),
);

export const LANGUAGES = [
  'english', 'hindi', 'bengali', 'marathi', 'telugu', 'tamil', 'gujarati', 'urdu',
  'kannada', 'odia', 'malayalam', 'punjabi', 'assamese',
] as const;
export type Language = (typeof LANGUAGES)[number];
export const language = z.enum(LANGUAGES);

export const profileInput = z.object({
  displayName: text(120).min(1).optional(),
  enrolmentNumber: optText(80),
  barCouncil: optText(120),
  phone: optText(30),
  city: optText(80),
  state: optText(80),
  bio: optText(2000),
  practiceAreas: z.array(text(60).min(1)).max(20).optional(),
  courts: z.array(text(120).min(1)).max(20).optional(),
  languages: z.array(language).max(13).optional(),
  preferredLanguage: language.optional(),
});
export type ProfileInput = z.infer<typeof profileInput>;

const email = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
  z.string().trim().max(200).email('Enter a valid email address.').nullable().optional(),
);
const id = z.string().uuid();
const optId = z.preprocess((v) => (v === '' ? null : v), id.nullable().optional());

export const clientInput = z.object({
  name: text(200).min(1, 'Name is required.'),
  email,
  phone: optText(30),
  address: optText(500),
  notes: optText(5000),
});
export const clientPatch = clientInput.partial();

export const CASE_STATUSES = ['open', 'pending', 'disposed', 'archived'] as const;
export const caseInput = z.object({
  title: text(300).min(1, 'Title is required.'),
  clientId: optId,
  caseNumber: optText(100),
  cnrNumber: z.preprocess(
    (v) => (typeof v === 'string' ? (v.trim() === '' ? null : v.trim().toUpperCase()) : v),
    z.string().regex(/^[A-Z0-9]{16}$/, 'A CNR number has 16 letters and digits.').nullable().optional(),
  ),
  court: optText(200),
  caseType: optText(100),
  status: z.enum(CASE_STATUSES).optional(),
  stage: optText(200),
  ourSide: optText(60),
  petitioner: optText(300),
  respondent: optText(300),
  opposingCounsel: optText(200),
  judge: optText(200),
  filingDate: dateOnly,
  description: optText(10000),
});
export const casePatch = caseInput.partial();
export const noteInput = z.object({ body: text(10000).min(1, 'Write a note first.') });

export const HEARING_STATUSES = ['scheduled', 'completed', 'adjourned', 'cancelled'] as const;
const instant = z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'Enter a valid date and time.').transform((v) => new Date(v));
export const hearingInput = z.object({
  caseId: id,
  hearingAt: instant,
  purpose: optText(300),
  court: optText(200),
  courtroom: optText(100),
  status: z.enum(HEARING_STATUSES).optional(),
  notes: optText(5000),
  remindBeforeMinutes: z.coerce.number().int().min(0).max(43200).optional(),
});
export const hearingPatch = hearingInput.omit({ caseId: true }).partial();

export const listQuery = z.object({
  q: z.string().trim().max(200).optional(),
  status: z.string().max(20).optional(),
  clientId: id.optional(),
  caseId: id.optional(),
  from: instant.optional(),
  to: instant.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
  offset: z.coerce.number().int().min(0).max(100000).default(0),
});
export const markRead = z.object({ ids: z.array(id).max(200).optional(), all: z.boolean().optional() });

/* ---------- AI features ---------- */
const optUuid = z.string().uuid().nullable().optional();
export const chatInput = z.object({
  conversationId: z.string().uuid().optional(),
  message: text(20000).min(1, 'Write a question first.'),
  caseId: optUuid,
});
export const researchInput = z.object({
  question: text(8000).min(5, 'Describe the legal question.'),
  materials: text(200000).optional(),
  documentIds: z.array(z.string().uuid()).max(5).optional(),
  caseId: optUuid,
});
export const analysisInput = z.object({
  kind: z.enum(['contract', 'judgment', 'summary']),
  text: text(700000).optional(),
  documentId: z.string().uuid().optional(),
  caseId: optUuid,
  side: optText(200), // contract review: which party we act for
}).refine((v) => v.text || v.documentId, 'Paste the text or choose a document.');
export const translateInput = z.object({
  text: text(40000).min(1, 'Enter the text to translate.'),
  from: z.union([language, z.literal('auto')]).default('auto'),
  to: language,
  style: z.enum(['faithful', 'plain']).default('faithful'),
  caseId: optUuid,
});
export const draftCreate = z.object({
  title: text(200).min(1, 'Give the draft a title.'),
  docType: text(60).default('custom'),
  language: language.default('english'),
  content: text(300000).default(''),
  caseId: optUuid,
});
export const draftPatch = z.object({
  title: text(200).min(1).optional(),
  docType: text(60).optional(),
  language: language.optional(),
  content: text(300000).optional(),
  caseId: optUuid,
});
export const draftGenerate = z.object({
  docType: text(60).default('custom'),
  title: text(200).optional(),
  instructions: text(30000).min(10, 'Describe the facts and what the document should achieve.'),
  language: language.default('english'),
  caseId: optUuid,
});
export const draftEdit = z.object({
  instruction: text(4000).min(3, 'Say what to change.'),
  passage: text(30000).optional(), // restrict the change to this passage
});
export const documentInit = z.object({
  fileName: text(255).min(1),
  sizeBytes: z.coerce.number().int().min(1).max(25 * 1024 * 1024, 'PDFs up to 25 MB are supported.'),
  title: optText(200),
  caseId: optUuid,
});
export const analysesQuery = z.object({ kind: z.string().max(20).optional(), documentId: z.string().uuid().optional() });
