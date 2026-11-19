import { and, asc, count, desc, eq, gte, sql } from 'drizzle-orm';
import type { Db } from '@/lib/db';
import { aiUsage, analyses, conversations, documents, draftVersions, drafts, messages, type MessageFlag } from '@/lib/db/schema';
import { notFound } from '@/lib/http';
import { HttpError } from '@/lib/http-errors';
import { aiConfig } from '@/lib/config';
import { assertOwnsCase } from './practice';

/* ---------- AI usage / daily limit (counted in the database, so it holds across serverless instances) ---------- */

export async function assertAiQuota(db: Db, advocateId: string) {
  const { dailyLimit } = aiConfig();
  const since = new Date(Date.now() - 864e5);
  const [r] = await db.select({ n: count() }).from(aiUsage).where(and(eq(aiUsage.advocateId, advocateId), gte(aiUsage.createdAt, since)));
  if (r.n >= dailyLimit) throw new HttpError(429, `Daily AI limit reached (${dailyLimit} requests per 24 hours). Please try again later.`, 'quota');
}
export async function recordUsage(db: Db, advocateId: string, kind: string, model: string, input: number, output: number) {
  await db.insert(aiUsage).values({ advocateId, kind, model, inputTokens: input, outputTokens: output });
}

/* ---------- conversations ---------- */

export async function listConversations(db: Db, advocateId: string) {
  return db.select().from(conversations).where(eq(conversations.advocateId, advocateId)).orderBy(desc(conversations.updatedAt)).limit(100);
}
export async function getConversation(db: Db, advocateId: string, id: string) {
  const [c] = await db.select().from(conversations).where(and(eq(conversations.id, id), eq(conversations.advocateId, advocateId)));
  if (!c) throw notFound('Conversation not found');
  return c;
}
export async function createConversation(db: Db, advocateId: string, title: string, caseId?: string | null) {
  await assertOwnsCase(db, advocateId, caseId);
  const [c] = await db.insert(conversations).values({ advocateId, title: title.slice(0, 80) || 'New conversation', caseId: caseId ?? null }).returning();
  return c;
}
export async function conversationMessages(db: Db, advocateId: string, conversationId: string) {
  return db.select().from(messages).where(and(eq(messages.conversationId, conversationId), eq(messages.advocateId, advocateId))).orderBy(asc(messages.createdAt), asc(messages.id));
}
export async function addMessage(db: Db, advocateId: string, conversationId: string, role: 'user' | 'assistant', content: string, extra: { flags?: MessageFlag[]; model?: string } = {}) {
  const [m] = await db.insert(messages).values({ advocateId, conversationId, role, content, flags: extra.flags ?? [], model: extra.model ?? null }).returning();
  await db.update(conversations).set({ updatedAt: new Date() }).where(eq(conversations.id, conversationId));
  return m;
}
export async function deleteConversation(db: Db, advocateId: string, id: string) {
  const r = await db.delete(conversations).where(and(eq(conversations.id, id), eq(conversations.advocateId, advocateId))).returning({ id: conversations.id });
  if (!r.length) throw notFound('Conversation not found');
}

/* ---------- drafts ---------- */

type NewDraft = { title: string; docType?: string; language?: string; content?: string; caseId?: string | null };

export async function listDrafts(db: Db, advocateId: string, caseId?: string) {
  const where = [eq(drafts.advocateId, advocateId)];
  if (caseId) where.push(eq(drafts.caseId, caseId));
  return db.select({ id: drafts.id, title: drafts.title, docType: drafts.docType, language: drafts.language, caseId: drafts.caseId, updatedAt: drafts.updatedAt })
    .from(drafts).where(and(...where)).orderBy(desc(drafts.updatedAt)).limit(200);
}
export async function createDraft(db: Db, advocateId: string, v: NewDraft, note = 'Created') {
  await assertOwnsCase(db, advocateId, v.caseId);
  const [d] = await db.insert(drafts).values({ ...v, advocateId, caseId: v.caseId ?? null }).returning();
  if (v.content) await db.insert(draftVersions).values({ advocateId, draftId: d.id, content: v.content, note });
  return d;
}
export async function getDraft(db: Db, advocateId: string, id: string) {
  const [d] = await db.select().from(drafts).where(and(eq(drafts.id, id), eq(drafts.advocateId, advocateId)));
  if (!d) throw notFound('Draft not found');
  return d;
}
export async function listVersions(db: Db, advocateId: string, draftId: string) {
  return db.select({ id: draftVersions.id, note: draftVersions.note, createdAt: draftVersions.createdAt, chars: sql<number>`length(${draftVersions.content})` })
    .from(draftVersions).where(and(eq(draftVersions.draftId, draftId), eq(draftVersions.advocateId, advocateId))).orderBy(desc(draftVersions.createdAt)).limit(50);
}
/** Saves new content, keeping the previous text as a version so any change can be undone. */
export async function saveDraft(db: Db, advocateId: string, id: string, patch: Partial<NewDraft>, note: string) {
  const current = await getDraft(db, advocateId, id);
  if (patch.caseId) await assertOwnsCase(db, advocateId, patch.caseId);
  if (patch.content !== undefined && patch.content !== current.content) {
    await db.insert(draftVersions).values({ advocateId, draftId: id, content: current.content, note });
  }
  const clean = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
  const [d] = await db.update(drafts).set(clean).where(and(eq(drafts.id, id), eq(drafts.advocateId, advocateId))).returning();
  return d;
}
export async function restoreVersion(db: Db, advocateId: string, draftId: string, versionId: string) {
  const [v] = await db.select().from(draftVersions).where(and(eq(draftVersions.id, versionId), eq(draftVersions.draftId, draftId), eq(draftVersions.advocateId, advocateId)));
  if (!v) throw notFound('Version not found');
  return saveDraft(db, advocateId, draftId, { content: v.content }, 'Before restoring an earlier version');
}
export async function deleteDraft(db: Db, advocateId: string, id: string) {
  const r = await db.delete(drafts).where(and(eq(drafts.id, id), eq(drafts.advocateId, advocateId))).returning({ id: drafts.id });
  if (!r.length) throw notFound('Draft not found');
}

/* ---------- documents ---------- */

export const documentCols = {
  id: documents.id, caseId: documents.caseId, title: documents.title, fileName: documents.fileName, sizeBytes: documents.sizeBytes,
  status: documents.status, pageCount: documents.pageCount, createdAt: documents.createdAt,
  textChars: sql<number>`coalesce(length(${documents.extractedText}), 0)`,
};
export async function listDocuments(db: Db, advocateId: string, caseId?: string) {
  const where = [eq(documents.advocateId, advocateId)];
  if (caseId) where.push(eq(documents.caseId, caseId));
  return db.select(documentCols).from(documents).where(and(...where)).orderBy(desc(documents.createdAt)).limit(200);
}
export async function getDocumentRow(db: Db, advocateId: string, id: string) {
  const [d] = await db.select().from(documents).where(and(eq(documents.id, id), eq(documents.advocateId, advocateId)));
  if (!d) throw notFound('Document not found');
  return d;
}

/* ---------- saved analyses ---------- */

export async function saveAnalysis(db: Db, advocateId: string, v: { kind: string; title: string; result: unknown; model?: string; documentId?: string | null; caseId?: string | null }) {
  const [a] = await db.insert(analyses).values({ advocateId, kind: v.kind, title: v.title.slice(0, 200), result: v.result as object, model: v.model ?? null, documentId: v.documentId ?? null, caseId: v.caseId ?? null }).returning();
  return a;
}
export async function listAnalyses(db: Db, advocateId: string, o: { kind?: string; documentId?: string }) {
  const where = [eq(analyses.advocateId, advocateId)];
  if (o.kind) where.push(eq(analyses.kind, o.kind));
  if (o.documentId) where.push(eq(analyses.documentId, o.documentId));
  return db.select({ id: analyses.id, kind: analyses.kind, title: analyses.title, documentId: analyses.documentId, createdAt: analyses.createdAt })
    .from(analyses).where(and(...where)).orderBy(desc(analyses.createdAt)).limit(100);
}
export async function getAnalysis(db: Db, advocateId: string, id: string) {
  const [a] = await db.select().from(analyses).where(and(eq(analyses.id, id), eq(analyses.advocateId, advocateId)));
  if (!a) throw notFound('Analysis not found');
  return a;
}
export async function deleteAnalysis(db: Db, advocateId: string, id: string) {
  const r = await db.delete(analyses).where(and(eq(analyses.id, id), eq(analyses.advocateId, advocateId))).returning({ id: analyses.id });
  if (!r.length) throw notFound('Analysis not found');
}
