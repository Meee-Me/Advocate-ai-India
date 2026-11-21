import { api, json, readBody } from '@/lib/http';
import { assertConsent } from '@/lib/ai/consent';
import { runText } from '@/lib/ai/client';
import { systemPrompt, DRAFT_TYPES, languageName } from '@/lib/ai/prompts';
import { matterContext } from '@/lib/ai/context';
import { guard } from '@/lib/legal/citation-guard';
import { citationMode } from '@/lib/config';
import { assertAiQuota, createDraft, recordUsage } from '@/lib/db/repos/work';
import { draftGenerate } from '@/lib/validation';

export const maxDuration = 300;

/** Writes a first draft from the advocate's facts. Facts not supplied stay as [●] placeholders. */
export const POST = api(async ({ req, db, advocateId }) => {
  const b = await readBody(req, draftGenerate);
  assertConsent(b);
  await assertAiQuota(db, advocateId);
  const matter = b.sendCaseDetails ? await matterContext(db, advocateId, b.caseId) : undefined;
  const label = DRAFT_TYPES[b.docType] ?? b.docType;
  const content = `Document type: ${label}\nLanguage: ${languageName(b.language)}\n\nFACTS AND INSTRUCTIONS FROM THE ADVOCATE:\n${b.instructions}`;
  const run = await runText({ kind: 'draft', system: systemPrompt('draft', { matter }), messages: [{ role: 'user', content }], effort: 'high', maxTokens: 32000 });
  await recordUsage(db, advocateId, 'draft', run.model, run.inputTokens, run.outputTokens, run.requests);
  // Authorities are not tagged inside a document for filing; they are listed for checking instead.
  // Strict: a citation that is not in the advocate's own material is replaced by a placeholder, never filed.
  const guarded = guard(run.text, [b.instructions, matter ?? ''], { inline: false, citations: citationMode(), placeholder: '[CITATION TO BE VERIFIED]' });
  const flags = guarded.flags;
  const draft = await createDraft(db, advocateId, { title: b.title || label, docType: b.docType, language: b.language, content: guarded.text, caseId: b.caseId }, 'AI first draft');
  return json({ draft, flags, truncated: run.truncated }, 201);
});
