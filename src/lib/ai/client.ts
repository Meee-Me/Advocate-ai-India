import { z, type ZodType } from 'zod';
import { aiConfig } from '@/lib/config';
import { AiError } from './errors';
import { anthropicProvider } from './providers/anthropic';
import { mockProvider } from './providers/mock';
import { sambanovaProvider } from './providers/sambanova';
import type { AiProvider, RunInput, RunResult, StreamEvent } from './types';

export type { RunInput, RunResult, StreamEvent, Effort, ChatMessage } from './types';

/** The single place that decides which vendor answers. No fallback: a vendor's failure is reported, not hidden. */
export function getProvider(): AiProvider {
  const cfg = aiConfig();
  if (cfg.provider === 'mock') return mockProvider;
  if (cfg.provider === 'anthropic') return anthropicProvider(cfg.anthropic);
  return sambanovaProvider({ ...cfg.sambanova, limits: cfg.limits });
}

function checkSize(input: RunInput) {
  const { maxInputChars, provider } = aiConfig();
  if (provider === 'mock') return;
  const size = input.system.length + input.messages.reduce((n, m) => n + m.content.length, 0);
  if (size > maxInputChars) {
    throw new AiError(`That is too long for the AI to read in one go (${Math.round(size / 1000)}k characters; the limit is ${Math.round(maxInputChars / 1000)}k). Use a shorter document or split it.`, 413, 'ai_too_long');
  }
}

/** Streams text deltas, then a final event with the whole result. */
export async function* streamText(input: RunInput): AsyncGenerator<StreamEvent> {
  checkSize(input);
  yield* getProvider().stream(input);
}

export async function runText(input: RunInput): Promise<RunResult> {
  checkSize(input);
  return getProvider().complete(input);
}

/** Finds the JSON object in a model answer (tolerates ``` fences and chatter around it). */
export function extractJson(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('no JSON object found');
  return JSON.parse(t.slice(start, end + 1));
}

const describe = (error: z.ZodError | Error) =>
  error instanceof z.ZodError
    ? error.issues.slice(0, 6).map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')
    : error.message;

/**
 * An answer that must match `schema`. The provider is asked for JSON of that shape, but no
 * vendor is trusted to obey: the reply is parsed and validated here, and if it is wrong the
 * model is shown exactly what was wrong and asked once more. Still invalid -> a clear error.
 */
export async function runStructured<T>(input: RunInput, schema: ZodType<T>): Promise<RunResult & { data: T }> {
  checkSize(input);
  const provider = getProvider();
  const jsonSchema = z.toJSONSchema(schema as never) as Record<string, unknown>;
  delete jsonSchema.$schema;
  const withFormat: RunInput = {
    ...input,
    system: `${input.system}\n\nOUTPUT FORMAT: Reply with ONE JSON object only, matching this JSON Schema exactly. Every field is required. No markdown fences, no text before or after.\n${JSON.stringify(jsonSchema)}`,
  };
  const structured = { schema: schema as ZodType<unknown>, jsonSchema };

  let first = await provider.complete(withFormat, structured);
  const attempt = (r: RunResult): { data?: T; problem?: string } => {
    if (r.truncated) return { problem: 'truncated' };
    try {
      const parsed = schema.safeParse(extractJson(r.text));
      return parsed.success ? { data: parsed.data } : { problem: describe(parsed.error) };
    } catch (e) {
      return { problem: describe(e as Error) };
    }
  };
  let a = attempt(first);
  if (a.problem === 'truncated') {
    throw new AiError('The analysis was too long to finish. Try a shorter document or a narrower question.', 422, 'ai_truncated');
  }
  if (a.data !== undefined) return { ...first, data: a.data };

  // One repair attempt, with the exact problem.
  const second = await provider.complete({
    ...withFormat,
    messages: [...input.messages, { role: 'assistant', content: first.text.slice(0, 20000) }, { role: 'user', content: `That reply could not be used: ${a.problem}. Reply again with ONLY the corrected JSON object.` }],
  }, structured);
  const merged = { ...second, requests: first.requests + second.requests, inputTokens: first.inputTokens + second.inputTokens, outputTokens: first.outputTokens + second.outputTokens };
  first = second;
  a = attempt(first);
  if (a.problem === 'truncated') throw new AiError('The analysis was too long to finish. Try a shorter document or a narrower question.', 422, 'ai_truncated');
  if (a.data === undefined) throw new AiError('The AI could not produce a usable answer for this. Please try again, or try a shorter input.', 502, 'ai_format');
  return { ...merged, data: a.data };
}
