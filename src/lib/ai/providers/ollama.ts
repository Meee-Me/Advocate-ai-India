import { AiError } from '../errors';
import type { AiProvider, RunInput, RunResult, StreamEvent, StructuredOptions } from '../types';
import { humanWait, parseDuration } from './sambanova';

/**
 * Ollama Cloud, through its OpenAI-compatible Chat Completions endpoint (default https://ollama.com/v1).
 *
 * Differences from the SambaNova provider, on purpose:
 *  - No `response_format`: cloud models are not guaranteed to honour a JSON schema, so JSON answers rely on the
 *    format instructions in the prompt plus the validation and single repair retry in `runStructured` (client.ts).
 *  - gpt-oss models send their thinking in a separate `reasoning` field; only `content` is ever read or shown.
 *  - The account's usage limits are enforced by Ollama. Its 429 is reported in plain words; nothing is paced here.
 * The API key is only ever sent as the Authorization header and is never logged or put in an error message.
 */
export interface OllamaConfig {
  /** Provider name and key variable shown in logs and errors; defaults to Ollama. Lets another OpenAI-compatible vendor (Groq) reuse this code. */
  name?: string;
  keyVar?: string;
  /** Header that carries the key when it is not the usual "Authorization: Bearer" (Sarvam uses api-subscription-key). */
  authHeader?: string;
  /** Sent as reasoning_effort when set (Gemini thinks for a long time by default, which makes answers slow). */
  reasoningEffort?: string;
  apiKey: string;
  baseUrl: string;
  model: string;
  maxOutputTokens: number;
  timeoutMs: number;
}

const estimateTokens = (chars: number) => Math.ceil(chars / 3.5);

/** Turns a non-2xx answer into an AiError with a message an advocate can act on. */
export async function ollamaError(res: Response, model: string, vendor = 'Ollama Cloud'): Promise<AiError> {
  // The body is read once, only to recognise "context too long"; it is never logged or shown (it could echo request data).
  let detail = '';
  try {
    const raw = await res.text();
    try { detail = String(JSON.parse(raw)?.error?.message ?? raw).slice(0, 300); } catch { detail = raw.slice(0, 300); }
  } catch { /* unreadable body */ }
  if (res.status === 429) {
    const wait = parseDuration(res.headers.get('retry-after')) ?? undefined;
    console.error(`${vendor} usage limit reached`);
    return new AiError(`The AI service's usage limit has been reached${wait ? `. Please try again in about ${humanWait(wait)}` : ' for now. Please try again later'}. Everyone using this site shares that limit.`, 429, 'ai_rate_limited', wait);
  }
  if (res.status === 401 || res.status === 403) {
    console.error(`${vendor} rejected the API key (HTTP ${res.status})`);
    return new AiError('The AI service is not set up correctly (its key was rejected). Please contact the site owner.', 503, 'ai_auth');
  }
  if (res.status === 402) {
    console.error(`${vendor} asked for payment or a plan upgrade (HTTP 402)`);
    return new AiError('The AI service needs a plan upgrade before it can answer. Please contact the site owner.', 503, 'ai_auth');
  }
  if (res.status === 404) {
    console.error(`${vendor} does not know the model (HTTP 404)`, model);
    return new AiError('The configured AI model is not available. Please contact the site owner.', 503, 'ai_model_unavailable');
  }
  if (res.status === 400 || res.status === 413 || res.status === 422) {
    console.error(`${vendor} rejected a request:`, res.status);
    if (/context|too long|maximum|exceed|token limit/i.test(detail)) {
      return new AiError('That is too long for the AI model to read in one go. Use a shorter document or a narrower question.', 413, 'ai_too_long');
    }
    return new AiError('The AI service could not process that request. Try a shorter input.', 502, 'ai_bad_request');
  }
  console.error(`${vendor} error`, res.status);
  return new AiError('The AI service is not responding properly right now. Please try again in a minute.', 503, 'ai_unavailable');
}

export function ollamaProvider(cfg: OllamaConfig): AiProvider {
  if (!cfg.apiKey) throw new AiError(`${cfg.keyVar ?? 'OLLAMA_API_KEY'} is not set, so the AI features are unavailable.`, 503, 'not_configured');
  if (!cfg.model) throw new AiError(`The model for ${cfg.name ?? 'this AI vendor'} is not set, so the AI features are unavailable.`, 503, 'not_configured');
  const url = `${cfg.baseUrl.replace(/\/+$/, '')}/chat/completions`;

  // Only standard OpenAI parameters are sent. `structured` is deliberately unused (see the note at the top).
  const body = (input: RunInput, stream: boolean) => ({
    model: cfg.model,
    messages: [{ role: 'system', content: input.system }, ...input.messages],
    stream,
    ...(cfg.reasoningEffort ? { reasoning_effort: cfg.reasoningEffort } : {}),
    max_tokens: Math.min(input.maxTokens ?? cfg.maxOutputTokens, cfg.maxOutputTokens),
    // Low temperature: legal work should be consistent, not creative.
    temperature: input.kind === 'chat' ? 0.3 : 0.1,
  });

  /** POST with one retry for network errors and 5xx (never for 4xx: those will not change). */
  async function post(input: RunInput, stream: boolean): Promise<{ res: Response; requests: number }> {
    let requests = 0;
    for (let attempt = 0; ; attempt++) {
      try {
        requests++;
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(cfg.authHeader ? { [cfg.authHeader]: cfg.apiKey } : { Authorization: `Bearer ${cfg.apiKey}` }) },
          body: JSON.stringify(body(input, stream)),
          signal: AbortSignal.timeout(cfg.timeoutMs),
          cache: 'no-store',
        });
        if (res.ok) return { res, requests };
        if (res.status >= 500 && attempt === 0) { await new Promise((r) => setTimeout(r, 800)); continue; }
        throw await ollamaError(res, cfg.model, cfg.name ?? 'Ollama Cloud');
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
    name: cfg.name ?? 'ollama',

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
        const piece = choice?.delta?.content; // the model's thinking arrives in `reasoning` and is never shown
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

    // `structured` is accepted for the interface but not sent: see the note at the top of this file.
    async complete(input, _structured?: StructuredOptions): Promise<RunResult> {
      const { res, requests } = await post(input, false);
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
