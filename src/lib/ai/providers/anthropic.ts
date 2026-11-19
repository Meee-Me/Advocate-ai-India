import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { AiError } from '../errors';
import type { AiProvider, RunInput, RunResult, StreamEvent, StructuredOptions } from '../types';

/** Anthropic Claude. Selectable with AI_PROVIDER=anthropic; it is never used as an automatic fallback. */
export interface AnthropicConfig { apiKey: string; model: string; refusalFallback: boolean }

function mapError(error: unknown): never {
  if (error instanceof AiError) throw error;
  if (error instanceof Anthropic.RateLimitError) throw new AiError('The AI service is busy right now. Please try again in a minute.', 429, 'ai_rate_limited', 60);
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
    console.error('Anthropic credentials rejected');
    throw new AiError('The AI service is not set up correctly (its key was rejected). Please contact the site owner.', 503, 'ai_auth');
  }
  if (error instanceof Anthropic.BadRequestError) {
    console.error('Anthropic rejected a request:', error.message);
    throw new AiError('The AI service could not process that request. Try a shorter input.', 502, 'ai_bad_request');
  }
  if (error instanceof Anthropic.APIConnectionError) throw new AiError('Could not reach the AI service. Please try again.', 503, 'ai_unreachable');
  if (error instanceof Anthropic.APIError) throw new AiError('The AI service had a problem. Please try again.', 502, 'ai_error');
  throw error;
}

function finish(message: Anthropic.Message): RunResult {
  if (message.stop_reason === 'refusal') {
    throw new AiError('The AI declined to answer this request. Try rephrasing it.', 422, 'ai_refused');
  }
  return {
    text: message.content.map((b) => (b.type === 'text' ? b.text : '')).join(''),
    model: message.model,
    inputTokens: message.usage.input_tokens,
    outputTokens: message.usage.output_tokens,
    truncated: message.stop_reason === 'max_tokens',
    requests: 1,
  };
}

export function anthropicProvider(cfg: AnthropicConfig): AiProvider {
  if (!cfg.apiKey) throw new AiError('ANTHROPIC_API_KEY is not set, so the AI features are unavailable.', 503, 'not_configured');
  const client = new Anthropic({ apiKey: cfg.apiKey, maxRetries: 2, timeout: 5 * 60_000 });
  const params = (input: RunInput, structured?: StructuredOptions) => ({
    model: cfg.model,
    max_tokens: input.maxTokens ?? 16000,
    system: input.system,
    messages: input.messages,
    thinking: { type: 'adaptive' as const },
    output_config: { effort: input.effort ?? 'medium', ...(structured ? { format: zodOutputFormat(structured.schema as never) } : {}) },
  });
  return {
    name: 'anthropic',
    async *stream(input): AsyncGenerator<StreamEvent> {
      try {
        const body = params(input);
        const stream = cfg.refusalFallback
          ? (client.beta.messages.stream({ ...body, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } as never) as unknown as ReturnType<Anthropic['messages']['stream']>)
          : client.messages.stream(body);
        for await (const e of stream) if (e.type === 'content_block_delta' && e.delta.type === 'text_delta') yield { type: 'delta', text: e.delta.text };
        yield { type: 'done', result: finish(await stream.finalMessage()) };
      } catch (error) { mapError(error); }
    },
    async complete(input, structured) {
      try { return finish(await client.messages.stream(params(input, structured) as never).finalMessage()); } catch (error) { mapError(error); }
    },
  };
}
