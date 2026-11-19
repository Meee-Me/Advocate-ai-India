import { api, badRequest, HttpError, readBody } from '@/lib/http';
import { runStructured } from '@/lib/ai/client';
import { systemPrompt, type Task } from '@/lib/ai/prompts';
import { contractSchema, judgmentSchema, summarySchema } from '@/lib/ai/schemas';
import { verifyContract, verifyJudgment } from '@/lib/ai/postprocess';
import { guard } from '@/lib/legal/citation-guard';
import { assertAiQuota, getDocumentRow, recordUsage, saveAnalysis } from '@/lib/db/repos/work';
import { assertOwnsCase } from '@/lib/db/repos/practice';
import { hasUsableText } from '@/lib/pdf/extract';
import { getStorage } from '@/lib/storage';
import { analysisInput } from '@/lib/validation';
import type Anthropic from '@anthropic-ai/sdk';

export const maxDuration = 300;
const MAX_NATIVE_PDF = 20 * 1024 * 1024; // base64 grows it by a third; the API accepts 32 MB

const INSTRUCTION = {
  contract: (side?: string | null) => `Review this contract.${side ? ` We act for: ${side}.` : ''}`,
  judgment: () => 'Analyse this judgment or order.',
  summary: () => 'Summarise this document.',
};

/** Contract / judgment analysis and document summaries, from pasted text or an uploaded PDF. */
export const POST = api(async ({ req, db, advocateId }) => {
  const b = await readBody(req, analysisInput);
  await assertAiQuota(db, advocateId);
  await assertOwnsCase(db, advocateId, b.caseId);

  let text: string | null = b.text ?? null;
  let pdf: Uint8Array | null = null;
  let title = 'Pasted text';
  let documentId: string | null = null;
  if (b.documentId) {
    const d = await getDocumentRow(db, advocateId, b.documentId);
    if (d.status !== 'uploaded') throw badRequest('That document has not finished uploading.');
    title = d.title;
    documentId = d.id;
    if (hasUsableText(d.extractedText, d.pageCount)) text = d.extractedText;
    else {
      // Scanned PDF (no text layer): let Claude read the pages directly.
      if (d.sizeBytes > MAX_NATIVE_PDF) throw new HttpError(413, 'This scanned PDF is larger than 20 MB. Split it into smaller parts.', 'too_large');
      pdf = await getStorage().read(d.storagePath);
      if (!pdf) throw new HttpError(404, 'The stored file could not be found.', 'not_found');
      text = null;
    }
  }

  const instruction = INSTRUCTION[b.kind](b.side);
  const content: Anthropic.ContentBlockParam[] = pdf
    ? [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: Buffer.from(pdf).toString('base64') } }, { type: 'text', text: instruction }]
    : [{ type: 'text', text: `${instruction}\n\n<document>\n${text}\n</document>` }];
  const input = { kind: b.kind, system: systemPrompt(b.kind as Task), messages: [{ role: 'user' as const, content }], effort: 'high' as const, maxTokens: 20000 };

  let result: unknown;
  let model = '';
  let flags: ReturnType<typeof guard>['flags'] = [];
  if (b.kind === 'contract') {
    const run = await runStructured(input, contractSchema);
    ({ model } = run);
    result = verifyContract(run.data, text);
    await recordUsage(db, advocateId, b.kind, run.model, run.inputTokens, run.outputTokens);
  } else if (b.kind === 'judgment') {
    const run = await runStructured(input, judgmentSchema);
    ({ model } = run);
    result = verifyJudgment(run.data, text);
    await recordUsage(db, advocateId, b.kind, run.model, run.inputTokens, run.outputTokens);
  } else {
    const run = await runStructured(input, summarySchema);
    ({ model } = run);
    result = run.data;
    await recordUsage(db, advocateId, b.kind, run.model, run.inputTokens, run.outputTokens);
  }
  // Any authority the model mentions in its own words that is not in the document is flagged.
  if (text) flags = guard(JSON.stringify(result), [text], false).flags;
  const saved = await saveAnalysis(db, advocateId, { kind: b.kind, title, result: { ...(result as object), flags, readAs: pdf ? 'pdf_pages' : 'text' }, model, documentId, caseId: b.caseId });
  return { id: saved.id, kind: b.kind, title, result, flags, readAs: pdf ? 'pdf_pages' : 'text' };
});
