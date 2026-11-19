import { api, badRequest, HttpError, readBody } from '@/lib/http';
import { runStructured } from '@/lib/ai/client';
import { systemPrompt, type Task } from '@/lib/ai/prompts';
import { contractSchema, judgmentSchema, summarySchema } from '@/lib/ai/schemas';
import { verifyContract, verifyJudgment } from '@/lib/ai/postprocess';
import { guardDeep } from '@/lib/legal/citation-guard';
import { citationMode } from '@/lib/config';
import { assertAiQuota, getDocumentRow, recordUsage, saveAnalysis } from '@/lib/db/repos/work';
import { assertOwnsCase } from '@/lib/db/repos/practice';
import { analysisInput } from '@/lib/validation';

export const maxDuration = 300;

const INSTRUCTION = {
  contract: (side?: string | null) => `Review this contract.${side ? ` We act for: ${side}.` : ''}`,
  judgment: () => 'Analyse this judgment or order.',
  summary: () => 'Summarise this document.',
};

/**
 * Contract / judgment analysis and summaries, from pasted text or an uploaded PDF. The AI only ever sees text:
 * a PDF's text layer, or, for scans, text read by OCR on this server first.
 */
export const POST = api(async ({ req, db, advocateId }) => {
  const b = await readBody(req, analysisInput);
  await assertAiQuota(db, advocateId);
  await assertOwnsCase(db, advocateId, b.caseId);

  let text = b.text ?? '';
  let title = 'Pasted text';
  let documentId: string | null = null;
  let readAs: 'text' | 'ocr' = 'text';
  let ocrConfidence: number | null = null;
  if (b.documentId) {
    const d = await getDocumentRow(db, advocateId, b.documentId);
    if (d.status !== 'uploaded') throw badRequest('That document has not finished uploading.');
    if (d.needsOcr && d.ocrPagesDone < (d.pageCount ?? 0)) {
      throw new HttpError(409, `This is a scanned PDF and has not been read yet (${d.ocrPagesDone} of ${d.pageCount} pages). Run "Read scanned pages (OCR)" first.`, 'needs_ocr');
    }
    if (!d.extractedText?.trim()) throw badRequest('No text could be read from this document.');
    title = d.title; documentId = d.id; text = d.extractedText;
    if (d.needsOcr) { readAs = 'ocr'; ocrConfidence = d.ocrConfidence ?? null; }
  }

  const content = `${INSTRUCTION[b.kind](b.side)}\n\n<document>\n${text}\n</document>`;
  const input = { kind: b.kind, system: systemPrompt(b.kind as Task), messages: [{ role: 'user' as const, content }], effort: 'high' as const, maxTokens: 20000 };

  let result: unknown;
  let model = '';
  if (b.kind === 'contract') {
    const run = await runStructured(input, contractSchema);
    model = run.model; result = verifyContract(run.data, text);
    await recordUsage(db, advocateId, b.kind, run.model, run.inputTokens, run.outputTokens, run.requests);
  } else if (b.kind === 'judgment') {
    const run = await runStructured(input, judgmentSchema);
    model = run.model; result = verifyJudgment(run.data, text);
    await recordUsage(db, advocateId, b.kind, run.model, run.inputTokens, run.outputTokens, run.requests);
  } else {
    const run = await runStructured(input, summarySchema);
    model = run.model; result = run.data;
    await recordUsage(db, advocateId, b.kind, run.model, run.inputTokens, run.outputTokens, run.requests);
  }
  // Strict: a citation the model mentions that is not in the document itself is removed from the result.
  const deep = guardDeep(result, [text], { inline: false, citations: citationMode() });
  result = deep.value;
  const flags = deep.flags;
  const meta = { flags, readAs, ocrConfidence };
  const saved = await saveAnalysis(db, advocateId, { kind: b.kind, title, result: { ...(result as object), ...meta }, model, documentId, caseId: b.caseId });
  return { id: saved.id, kind: b.kind, title, result, ...meta };
});
