import { api, badRequest, readBody } from '@/lib/http';
import { runStructured } from '@/lib/ai/client';
import { systemPrompt } from '@/lib/ai/prompts';
import { matterContext } from '@/lib/ai/context';
import { researchSchema } from '@/lib/ai/schemas';
import { verifyResearch } from '@/lib/ai/postprocess';
import { guardDeep } from '@/lib/legal/citation-guard';
import { citationMode } from '@/lib/config';
import { assertAiQuota, getDocumentRow, recordUsage, saveAnalysis } from '@/lib/db/repos/work';
import { assertOwnsCase } from '@/lib/db/repos/practice';
import { researchInput } from '@/lib/validation';

export const maxDuration = 300;

export const POST = api(async ({ req, db, advocateId }) => {
  const b = await readBody(req, researchInput);
  await assertAiQuota(db, advocateId);
  await assertOwnsCase(db, advocateId, b.caseId);
  const docs = await Promise.all((b.documentIds ?? []).map((id) => getDocumentRow(db, advocateId, id)));
  const materials = [b.materials, ...docs.map((d) => (d.extractedText ? `--- ${d.title} ---\n${d.extractedText}` : null))].filter(Boolean).join('\n\n');
  if (materials.length > 700_000) throw badRequest('The materials are too long. Select fewer or shorter documents.');
  const matter = await matterContext(db, advocateId, b.caseId);

  const content = `QUESTION:\n${b.question}\n\nMATERIALS (supplied by the advocate; the only source you may treat as verified):\n${materials || '(none supplied)'}`;
  const run = await runStructured({ kind: 'research', system: systemPrompt('research', { matter }), messages: [{ role: 'user', content }], effort: 'high', maxTokens: 20000 }, researchSchema);
  await recordUsage(db, advocateId, 'research', run.model, run.inputTokens, run.outputTokens, run.requests);

  const sources = [b.question, materials, matter ?? ''];
  const verified = verifyResearch(run.data, sources);
  // Strict: reporter citations that are not in the advocate's material are removed from every field.
  const deep = guardDeep(verified.result, sources, { inline: false, citations: citationMode() });
  const result = deep.value;
  const mode = citationMode();
  // In strict mode a removed citation appears only as "A citation was removed", never with its text.
  const kept = verified.flags.filter((f) => mode === 'tag' || f.kind !== 'citation');
  const flags = [...kept, ...deep.flags.filter((f) => !kept.some((x) => x.text === f.text))];
  const saved = await saveAnalysis(db, advocateId, { kind: 'research', title: b.question.slice(0, 120), result: { ...result, flags }, model: run.model, caseId: b.caseId });
  return { id: saved.id, result, flags, usedSources: docs.length };
});
