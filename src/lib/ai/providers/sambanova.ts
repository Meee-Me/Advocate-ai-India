import { AiError } from '../errors';
import type { AiProvider, RunInput, RunResult, StreamEvent, StructuredOptions } from '../types';

/**
 * SambaNova Cloud, through its OpenAI-compatible Chat Completions endpoint
 * (https://docs.sambanova.ai/docs/en/features/openai-compatibility).
 * SambaCloud answers HTTP 400 to request parameters it does not know, so only
 * documented, standard parameters are sent.
 */
export interface SambaNovaConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  maxOutputTokens: number;
  reasoningEffort: '' | 'low' | 'medium' | 'high';
  timeoutMs: number;
  limits: { rpm: number; rpd: number; tpd: number };
}

const estimateTokens = (chars: number) => Math.ceil(chars / 3.5);

/** "45", "1m30s", "12h3m", "2.5s" -> seconds. Unknown formats -> undefined. */
export function parseDuration(value: string | null | undefined): number | undefined {
  if (!value) return undefined;
  const v = value.trim();
  if (/^\d+(\.\d+)?$/.test(v)) return Math.ceil(Number(v));
  let total = 0;
  let matched = false;
  for (const m of v.matchAll(/(\d+(?:\.\d+)?)\s*(ms|h|m|s)/g)) {
    matched = true;
    total += Number(m[1]) * { ms: 0.001, s: 1, m: 60, h: 3600 }[m[2] as 'ms' | 's' | 'm' | 'h'];
  }
  return matched ? Math.ceil(total) : undefined;
}

export function humanWait(seconds: number | undefined): string {
  if (!seconds || seconds < 1) return 'a little while';
  if (seconds < 90) return `${Math.ceil(seconds)} seconds`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} minutes`;
  const totalMinutes = Math.round(seconds / 60); // round once, so "3 h 60 min" cannot happen
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** Turns a non-2xx answer into an AiError with a message an advocate can act on. */
export async function sambaError(res: Response, limits: SambaNovaConfig['limits']): Promise<AiError> {
  let detail = '';
  try { detail = JSON.stringify((await res.json())?.error?.message ?? '').slice(0, 300); } catch { /* not JSON */ }
  const h = res.headers;
  const retry = parseDuration(h.get('retry-after')) ?? parseDuration(h.get('x-ratelimit-reset-requests')) ?? undefined;
  if (res.status === 429) {
    const dayLeft = h.get('x-ratelimit-remaining-requests-day');
    const minLeft = h.get('x-ratelimit-remaining-requests');
    // Tokens first: a message like "tokens per day exceeded" also contains "per day".
    if (/token|TPD/i.test(detail)) {
      return new AiError("The AI plan's daily token allowance has been used up. Try again later, or use a shorter document.", 429, 'ai_rate_limited', retry);
    }
    if (dayLeft === '0' || /per day|daily|RPD/i.test(detail)) {
      const wait = parseDuration(h.get('x-ratelimit-reset-requests-day')) ?? retry;
      return new AiError(`The AI plan's daily request limit has been reached${limits.rpd ? ` (${limits.rpd} requests per day)` : ''}. It resets in about ${humanWait(wait)}. Everyone using this site shares that limit.`, 429, 'ai_rate_limited', wait);
    }
    const wait = retry ?? 60;
    return new AiError(`Too many AI requests in the last minute${limits.rpm && minLeft === '0' ? ` (the limit is ${limits.rpm} per minute)` : ''}. Please wait ${humanWait(wait)} and try again.`, 429, 'ai_rate_limited', wait);
  }
  if (res.status === 401 || res.status === 403) {
    console.error('SambaNova rejected the API key');
    return new AiError('The AI service is not set up correctly (its key was rejected). Please contact the site owner.', 503, 'ai_auth');
  }
  if (res.status === 400 || res.status === 413 || res.status === 422) {
    console.error('SambaNova rejected a request:', res.status, detail);
    if (/context|too long|maximum|exceed|token limit/i.test(detail)) {
      return new AiError('That is too long for the AI model to read in one go. Use a shorter document or a narrower question.', 413, 'ai_too_long');
    }
    return new AiError('The AI service could not process that request. Try a shorter input.', 502, 'ai_bad_request');
  }
  console.error('SambaNova error', res.status);
  return new AiError('The AI service is not responding properly right now. Please try again in a minute.', 503, 'ai_unavailable');
}

export function sambanovaProvider(cfg: SambaNovaConfig): AiProvider {
  if (!cfg.apiKey) throw new AiError('SAMBANOVA_API_KEY is not set, so the AI features are unavailable.', 503, 'not_configured');
  const url = `${cfg.baseUrl.replace(/\/+$/, '')}/chat/completions`;

  const body = (input: RunInput, stream: boolean, structured?: StructuredOptions) => ({
    model: cfg.model,
    messages: [{ role: 'system', content: input.system }, ...input.messages],
    stream,
    max_tokens: Math.min(input.maxTokens ?? cfg.maxOutputTokens, cfg.maxOutputTokens),
    // Low temperature: legal work should be consistent, not creative.
    temperature: input.kind === 'chat' ? 0.3 : 0.1,
    ...(cfg.reasoningEffort && /gpt-oss/i.test(cfg.model) ? { reasoning_effort: cfg.reasoningEffort } : {}),
    ...(structured ? { response_format: { type: 'json_schema', json_schema: { name: 'result', schema: structured.jsonSchema, strict: false } } } : {}),
  });

  /** POST with one retry for network errors and 5xx (never for 4xx: those will not change). */
  async function post(input: RunInput, stream: boolean, structured?: StructuredOptions): Promise<{ res: Response; requests: number }> {
    let requests = 0;
    for (let attempt = 0; ; attempt++) {
      try {
        requests++;
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
          body: JSON.stringify(body(input, stream, structured)),
          signal: AbortSignal.timeout(cfg.timeoutMs),
          cache: 'no-store',
        });
        if (res.ok) return { res, requests };
        if (res.status >= 500 && attempt === 0) { await new Promise((r) => setTimeout(r, 800)); continue; }
        throw await sambaError(res, cfg.limits);
      } catch (error) {
        if (error instanceof AiError) throw error;
        if (attempt === 0) { await new Promise((r) => setTimeout(r, 800)); continue; }
        const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
        throw new AiError(timedOut ? 'The AI took too long to answer. Try again, or use a shorter input.' : 'Could not reach the AI service. Please try again.', 503, timedOut ? 'ai_timeout' : 'ai_unreachable');
      }
    }
  }

  const inputChars = (input: RunInput) => input.system.length + input.messages.reduce((n, m) => n + m.content.length, 0);

  return {
    name: 'sambanova',

    async *stream(input): AsyncGenerator<StreamEvent> {
      const { res, requests } = await post(input, true);
      if (!res.body) throw new AiError('The AI returned an empty answer. Please try again.', 502, 'ai_empty');
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let text = '';
      let finish: string | null = null;
      let usage: { prompt_tokens?: number; completion_tokens?: number } | undefined;
      const handle = (line: string): string | null => {
        if (!line.startsWith('data:')) return null;
        const data = line.slice(5).trim();
        if (!data || data === '[DONE]') return null;
        let chunk: any; // eslint-disable-line @typescript-eslint/no-explicit-any
        try { chunk = JSON.parse(data); } catch { return null; }
        if (chunk.error) throw new AiError('The AI stopped in the middle of the answer. Please try again.', 502, 'ai_stream_error');
        if (chunk.usage) usage = chunk.usage;
        const choice = chunk.choices?.[0];
        if (choice?.finish_reason) finish = choice.finish_reason;
        const piece = choice?.delta?.content; // reasoning tokens arrive in other fields and are never shown
        return typeof piece === 'string' && piece ? piece : null;
      };
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let i: number;
          while ((i = buf.indexOf('\n')) >= 0) {
            const piece = handle(buf.slice(0, i).trim());
            buf = buf.slice(i + 1);
            if (piece) { text += piece; yield { type: 'delta', text: piece }; }
          }
        }
        const last = handle(buf.trim());
        if (last) { text += last; yield { type: 'delta', text: last }; }
      } catch (error) {
        if (error instanceof AiError) throw error;
        throw new AiError('The connection to the AI was interrupted. Please try again.', 503, 'ai_interrupted');
      }
      if (!text.trim()) throw new AiError('The AI returned an empty answer. Please try again.', 502, 'ai_empty');
      yield {
        type: 'done',
        result: {
          text, model: cfg.model, requests, truncated: finish === 'length',
          inputTokens: usage?.prompt_tokens ?? estimateTokens(inputChars(input)),
          outputTokens: usage?.completion_tokens ?? estimateTokens(text.length),
        },
      };
    },

    async complete(input, structured): Promise<RunResult> {
      const { res, requests } = await post(input, false, structured);
      const data: any = await res.json().catch(() => null); // eslint-disable-line @typescript-eslint/no-explicit-any
      const choice = data?.choices?.[0];
      const text = choice?.message?.content;
      if (typeof text !== 'string' || !text.trim()) throw new AiError('The AI returned an empty answer. Please try again.', 502, 'ai_empty');
      return {
        text, model: cfg.model, requests, truncated: choice.finish_reason === 'length',
        inputTokens: data.usage?.prompt_tokens ?? estimateTokens(inputChars(input)),
        outputTokens: data.usage?.completion_tokens ?? estimateTokens(text.length),
      };
    },
  };
}
