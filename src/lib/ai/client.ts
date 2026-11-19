import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { ZodType } from 'zod';
import { aiConfig, ConfigError } from '@/lib/config';
import { AiError } from './errors';
import { mockStream, mockStructured } from './mock';

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface RunInput {
  /** Used for usage accounting and (in mock mode) choosing a canned reply. */
  kind: string;
  system: string;
  messages: Anthropic.MessageParam[];
  effort?: Effort;
  maxTokens?: number;
}

export interface RunResult {
  text: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  /** The model stopped because it hit the output limit. */
  truncated: boolean;
}

export type StreamEvent = { type: 'delta'; text: string } | { type: 'done'; result: RunResult };

let cached: { key: string; client: Anthropic } | undefined;
function anthropic(): Anthropic {
  const { apiKey } = aiConfig();
  if (!apiKey) throw new ConfigError('ANTHROPIC_API_KEY is not set, so the AI features are unavailable.');
  if (!cached || cached.key !== apiKey) cached = { key: apiKey, client: new Anthropic({ apiKey, maxRetries: 2, timeout: 5 * 60_000 }) };
  return cached.client;
}

function params(input: RunInput, format?: ReturnType<typeof zodOutputFormat>) {
  const { model } = aiConfig();
  return {
    model,
    max_tokens: input.maxTokens ?? 16000,
    system: input.system,
    messages: input.messages,
    // Claude decides how much to think; "effort" sets the overall depth/cost.
    thinking: { type: 'adaptive' as const },
    output_config: { effort: input.effort ?? 'medium', ...(format ? { format } : {}) },
  };
}

function mapError(error: unknown): never {
  if (error instanceof AiError || error instanceof ConfigError) throw error;
  if (error instanceof Anthropic.RateLimitError) throw new AiError('The AI service is busy right now. Please try again in a minute.', 429, 'ai_busy');
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
    console.error('Anthropic credentials rejected');
    throw new AiError('The AI service is not set up correctly. Please contact the site owner.', 503, 'ai_auth');
  }
  if (error instanceof Anthropic.BadRequestError) {
    console.error('Anthropic rejected a request:', error.message);
    throw new AiError('The AI service could not process that request. If it contains a very large document, try a smaller one.', 502, 'ai_bad_request');
  }
  if (error instanceof Anthropic.APIConnectionError) throw new AiError('Could not reach the AI service. Please try again.', 503, 'ai_unreachable');
  if (error instanceof Anthropic.APIError) {
    console.error('Anthropic error', error.status);
    throw new AiError('The AI service had a problem. Please try again.', 502, 'ai_error');
  }
  throw error;
}

function finish(message: Anthropic.Message): RunResult {
  if (message.stop_reason === 'refusal') {
    throw new AiError('The AI declined to answer this request. Try rephrasing it, or splitting out the sensitive part.', 422, 'ai_refused');
  }
  const text = message.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
  return {
    text,
    model: message.model,
    inputTokens: message.usage.input_tokens,
    outputTokens: message.usage.output_tokens,
    truncated: message.stop_reason === 'max_tokens',
  };
}

/** Streams text deltas, then a final event with the whole result. */
export async function* streamText(input: RunInput): AsyncGenerator<StreamEvent> {
  const cfg = aiConfig();
  if (cfg.provider === 'mock') {
    yield* mockStream(input);
    return;
  }
  try {
    const body = params(input);
    // Optional: let the API re-run on a fallback model if safety classifiers decline.
    const stream = cfg.refusalFallback
      ? (anthropic().beta.messages.stream({ ...body, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } as never) as unknown as ReturnType<Anthropic['messages']['stream']>)
      : anthropic().messages.stream(body);
    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') yield { type: 'delta', text: event.delta.text };
    }
    yield { type: 'done', result: finish(await stream.finalMessage()) };
  } catch (error) {
    mapError(error);
  }
}

export async function runText(input: RunInput): Promise<RunResult> {
  let last: RunResult | undefined;
  for await (const e of streamText(input)) if (e.type === 'done') last = e.result;
  if (!last) throw new AiError('The AI returned no answer.');
  return last;
}

/** One request whose answer must match `schema` (Claude is constrained to the JSON schema, then validated again). */
export async function runStructured<T>(input: RunInput, schema: ZodType<T>): Promise<RunResult & { data: T }> {
  const cfg = aiConfig();
  if (cfg.provider === 'mock') {
    const r = mockStructured(input);
    return { ...r, data: schema.parse(JSON.parse(r.text)) };
  }
  try {
    const stream = anthropic().messages.stream(params(input, zodOutputFormat(schema as never)));
    const result = finish(await stream.finalMessage());
    if (result.truncated) throw new AiError('The analysis was too long to finish. Try a shorter document or a narrower question.', 422, 'ai_truncated');
    let parsed: unknown;
    try { parsed = JSON.parse(result.text); } catch { throw new AiError('The AI answered in an unexpected format. Please try again.', 502, 'ai_format'); }
    const checked = schema.safeParse(parsed);
    if (!checked.success) throw new AiError('The AI answered in an unexpected format. Please try again.', 502, 'ai_format');
    return { ...result, data: checked.data };
  } catch (error) {
    mapError(error);
  }
}
