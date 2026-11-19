// Mirrors supabase/migrations/*.sql (the SQL is the source of truth; tests run
// these queries against the real migration so any drift is caught).
import { sql } from 'drizzle-orm';
import {
  bigint, date, index, integer, jsonb, pgTable, text, timestamp, uuid,
} from 'drizzle-orm/pg-core';

const id = () => uuid('id').primaryKey().defaultRandom();
const created = () => timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow();
const updated = () => timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow();
const advocateRef = () => uuid('advocate_id').notNull().references(() => advocates.id, { onDelete: 'cascade' });

export const advocates = pgTable('advocates', {
  id: id(),
  deluxeAccountId: text('deluxe_account_id').notNull().unique(),
  deluxeHandle: text('deluxe_handle'),
  displayName: text('display_name').notNull(),
  enrolmentNumber: text('enrolment_number'),
  barCouncil: text('bar_council'),
  phone: text('phone'),
  city: text('city'),
  state: text('state'),
  bio: text('bio'),
  practiceAreas: text('practice_areas').array().notNull().default(sql`'{}'`),
  courts: text('courts').array().notNull().default(sql`'{}'`),
  languages: text('languages').array().notNull().default(sql`'{english}'`),
  preferredLanguage: text('preferred_language').notNull().default('english'),
  createdAt: created(),
  updatedAt: updated(),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true, mode: 'date' }),
});

export const clients = pgTable('clients', {
  id: id(),
  advocateId: advocateRef(),
  name: text('name').notNull(),
  email: text('email'),
  phone: text('phone'),
  address: text('address'),
  notes: text('notes'),
  createdAt: created(),
  updatedAt: updated(),
});

export const cases = pgTable('cases', {
  id: id(),
  advocateId: advocateRef(),
  clientId: uuid('client_id').references(() => clients.id, { onDelete: 'set null' }),
  title: text('title').notNull(),
  caseNumber: text('case_number'),
  cnrNumber: text('cnr_number'),
  court: text('court'),
  caseType: text('case_type'),
  status: text('status').notNull().default('open'),
  stage: text('stage'),
  ourSide: text('our_side'),
  petitioner: text('petitioner'),
  respondent: text('respondent'),
  opposingCounsel: text('opposing_counsel'),
  judge: text('judge'),
  filingDate: date('filing_date', { mode: 'string' }),
  description: text('description'),
  createdAt: created(),
  updatedAt: updated(),
});

export const caseNotes = pgTable('case_notes', {
  id: id(),
  advocateId: advocateRef(),
  caseId: uuid('case_id').notNull().references(() => cases.id, { onDelete: 'cascade' }),
  body: text('body').notNull(),
  createdAt: created(),
});

export const hearings = pgTable('hearings', {
  id: id(),
  advocateId: advocateRef(),
  caseId: uuid('case_id').notNull().references(() => cases.id, { onDelete: 'cascade' }),
  hearingAt: timestamp('hearing_at', { withTimezone: true, mode: 'date' }).notNull(),
  purpose: text('purpose'),
  court: text('court'),
  courtroom: text('courtroom'),
  status: text('status').notNull().default('scheduled'),
  notes: text('notes'),
  remindBeforeMinutes: integer('remind_before_minutes').notNull().default(1440),
  remindedAt: timestamp('reminded_at', { withTimezone: true, mode: 'date' }),
  createdAt: created(),
  updatedAt: updated(),
}, (t) => [index('hearings_advocate_time_idx').on(t.advocateId, t.hearingAt)]);

export const notifications = pgTable('notifications', {
  id: id(),
  advocateId: advocateRef(),
  kind: text('kind').notNull(),
  title: text('title').notNull(),
  body: text('body'),
  hearingId: uuid('hearing_id').references(() => hearings.id, { onDelete: 'cascade' }),
  readAt: timestamp('read_at', { withTimezone: true, mode: 'date' }),
  createdAt: created(),
});

export const documents = pgTable('documents', {
  id: id(),
  advocateId: advocateRef(),
  caseId: uuid('case_id').references(() => cases.id, { onDelete: 'set null' }),
  title: text('title').notNull(),
  fileName: text('file_name').notNull(),
  mimeType: text('mime_type').notNull(),
  sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull().default(0),
  storagePath: text('storage_path').notNull(),
  status: text('status').notNull().default('pending_upload'),
  pageCount: integer('page_count'),
  extractedText: text('extracted_text'),
  createdAt: created(),
  updatedAt: updated(),
});

export const analyses = pgTable('analyses', {
  id: id(),
  advocateId: advocateRef(),
  documentId: uuid('document_id').references(() => documents.id, { onDelete: 'cascade' }),
  caseId: uuid('case_id').references(() => cases.id, { onDelete: 'set null' }),
  kind: text('kind').notNull(),
  title: text('title').notNull(),
  result: jsonb('result').notNull(),
  model: text('model'),
  createdAt: created(),
});

export const drafts = pgTable('drafts', {
  id: id(),
  advocateId: advocateRef(),
  caseId: uuid('case_id').references(() => cases.id, { onDelete: 'set null' }),
  title: text('title').notNull(),
  docType: text('doc_type').notNull().default('custom'),
  language: text('language').notNull().default('english'),
  content: text('content').notNull().default(''),
  createdAt: created(),
  updatedAt: updated(),
});

export const draftVersions = pgTable('draft_versions', {
  id: id(),
  draftId: uuid('draft_id').notNull().references(() => drafts.id, { onDelete: 'cascade' }),
  advocateId: advocateRef(),
  content: text('content').notNull(),
  note: text('note'),
  createdAt: created(),
});

export const conversations = pgTable('conversations', {
  id: id(),
  advocateId: advocateRef(),
  caseId: uuid('case_id').references(() => cases.id, { onDelete: 'set null' }),
  title: text('title').notNull().default('New conversation'),
  createdAt: created(),
  updatedAt: updated(),
});

export type MessageFlag = { kind: string; text: string; note: string };

export const messages = pgTable('messages', {
  id: id(),
  conversationId: uuid('conversation_id').notNull().references(() => conversations.id, { onDelete: 'cascade' }),
  advocateId: advocateRef(),
  role: text('role').notNull(),
  content: text('content').notNull(),
  flags: jsonb('flags').$type<MessageFlag[]>().notNull().default(sql`'[]'::jsonb`),
  model: text('model'),
  createdAt: created(),
});

export const aiUsage = pgTable('ai_usage', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  advocateId: advocateRef(),
  kind: text('kind').notNull(),
  model: text('model'),
  inputTokens: integer('input_tokens').notNull().default(0),
  outputTokens: integer('output_tokens').notNull().default(0),
  createdAt: created(),
});
