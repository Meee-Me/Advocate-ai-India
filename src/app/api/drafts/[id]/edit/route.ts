import { api, badRequest, readBody, uuid } from '@/lib/http';
import { runText } from '@/lib/ai/client';
import { systemPrompt } from '@/lib/ai/prompts';
import { matterContext } from '@/lib/ai/context';
import { guard } from '@/lib/legal/citation-guard';
import { assertAiQuota, getDraft, recordUsage, saveDraft } from '@/lib/db/repos/work';
import { draftEdit } from '@/lib/validation';

export const maxDuration = 300;

/** AI edit: the previous text is kept as a version, so the change can always be undone. */
export const POST = api<{ id: string }>(async ({ req, db, advocateId, params }) => {
  const b = await readBody(req, draftEdit);
  await assertAiQuota(db, advocateId);
  const draft = await getDraft(db, advocateId, uuid(params.id));
  if (!draft.content.trim()) throw badRequest('This draft is empty. Write or generate something first.');
  if (b.passage && !draft.content.includes(b.passage)) throw badRequest('The selected passage is no longer in the draft.');
  const matter = await matterContext(db, advocateId, draft.caseId);
  const scope = b.passage ? `\n\nApply the instruction ONLY to this passage and leave the rest of the document unchanged:\n"""${b.passage}"""` : '';
  const content = `DOCUMENT:\n${draft.content}\n\nINSTRUCTION:\n${b.instruction}${scope}`;
  const run = await runText({ kind: 'edit', system: systemPrompt('edit', { matter }), messages: [{ role: 'user', content }], effort: 'high', maxTokens: 32000 });
  await recordUsage(db, advocateId, 'edit', run.model, run.inputTokens, run.outputTokens);
  if (run.truncated) throw badRequest('The revised document was too long to finish. Edit a smaller passage.');
  const { flags } = guard(run.text, [draft.content, b.instruction, matter ?? ''], false);
  return { draft: await saveDraft(db, advocateId, draft.id, { content: run.text }, `Before AI edit: ${b.instruction.slice(0, 80)}`), flags };
});
