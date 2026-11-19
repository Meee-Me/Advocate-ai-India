import { api, readBody } from '@/lib/http';
import { runStructured } from '@/lib/ai/client';
import { systemPrompt, languageName } from '@/lib/ai/prompts';
import { translationSchema } from '@/lib/ai/schemas';
import { assertAiQuota, recordUsage, saveAnalysis } from '@/lib/db/repos/work';
import { assertOwnsCase } from '@/lib/db/repos/practice';
import { translateInput } from '@/lib/validation';

export const maxDuration = 300;

export const POST = api(async ({ req, db, advocateId }) => {
  const b = await readBody(req, translateInput);
  await assertAiQuota(db, advocateId);
  await assertOwnsCase(db, advocateId, b.caseId);
  const from = b.from === 'auto' ? 'the source language (detect it)' : languageName(b.from);
  const style = b.style === 'plain' ? 'Use plain, simple wording a layperson client can understand, while keeping every legal fact intact.' : 'Translate faithfully and formally.';
  const content = `Translate from ${from} into ${languageName(b.to)}. ${style}\n\n<text>\n${b.text}\n</text>`;
  const run = await runStructured({ kind: 'translation', system: systemPrompt('translate'), messages: [{ role: 'user', content }], effort: 'medium', maxTokens: 20000 }, translationSchema);
  await recordUsage(db, advocateId, 'translation', run.model, run.inputTokens, run.outputTokens, run.requests);
  const result = { ...run.data, from: b.from, to: b.to, style: b.style };
  const saved = await saveAnalysis(db, advocateId, { kind: 'translation', title: `${b.from} → ${b.to}: ${b.text.slice(0, 80)}`, result, model: run.model, caseId: b.caseId });
  return { id: saved.id, ...result, notice: 'Working translation, not certified. Have a certified translator confirm anything to be filed in court.' };
});
