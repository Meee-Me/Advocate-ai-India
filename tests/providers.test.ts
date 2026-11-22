import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import * as chat from '@/app/api/chat/route';
import * as research from '@/app/api/research/route';
import * as translate from '@/app/api/translate/route';
import * as aiTest from '@/app/api/ai/test/route';
import * as health from '@/app/api/health/route';
import { getProvider, extractJson, runStructured, runText, streamText } from '@/lib/ai/client';
import { AiError } from '@/lib/ai/errors';
import { humanWait, parseDuration } from '@/lib/ai/providers/sambanova';
import { assertProviderCapacity, recordUsage } from '@/lib/db/repos/work';
import { getDb, schema } from '@/lib/db';
import { call, setup, signIn, type Who } from './harness';

const BASE = 'https://sn.test/v1';
/** Awaits a promise that must reject, and returns the error (fails the test if it resolves). */
const fails = async (p: Promise<unknown>): Promise<AiError> => { try { await p; } catch (e) { return e as AiError; } throw new Error('expected a rejection, but it succeeded'); };
const SYS = 'You are a test.';
const IN = { kind: 'chat', system: SYS, messages: [{ role: 'user' as const, content: 'hello' }] };

interface Sent { url: string; headers: Record<string, string>; body: any } // eslint-disable-line @typescript-eslint/no-explicit-any
let sent: Sent[] = [];
let replies: (() => Response | Promise<Response>)[] = [];

const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...headers } });
const completion = (content: string, extra: Record<string, unknown> = {}) =>
  json({ choices: [{ message: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 20 }, ...extra });
/** An SSE body, with arbitrary chunk boundaries (even mid-line). */
const sse = (events: unknown[], sizes = 40) => {
  const raw = events.map((e) => `data: ${typeof e === 'string' ? e : JSON.stringify(e)}\n\n`).join('');
  const enc = new TextEncoder();
  return new Response(new ReadableStream({ start(c) { for (let i = 0; i < raw.length; i += sizes) c.enqueue(enc.encode(raw.slice(i, i + sizes))); c.close(); } }), { status: 200, headers: { 'content-type': 'text/event-stream' } });
};
const delta = (content: string, finish: string | null = null) => ({ choices: [{ delta: { content }, finish_reason: finish }] });

beforeEach(() => {
  sent = []; replies = [];
  Object.assign(process.env, { AI_PROVIDER: 'sambanova', SAMBANOVA_API_KEY: 'test-key-123', SAMBANOVA_BASE_URL: BASE, AI_LIMIT_RPM: '0', AI_LIMIT_RPD: '0', AI_LIMIT_TPD: '0' });
  delete process.env.SAMBANOVA_MODEL; delete process.env.SAMBANOVA_REASONING_EFFORT;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    sent.push({ url: String(url), headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) });
    const next = replies.shift();
    if (!next) throw new Error(`unexpected request #${sent.length} to ${url}`);
    return next();
  }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('SambaNova provider: requests', () => {
  it('calls the documented endpoint with only standard parameters and the configured model', async () => {
    replies.push(() => completion('hi'));
    const r = await runText(IN);
    expect(r).toMatchObject({ text: 'hi', model: 'gpt-oss-120b', inputTokens: 100, outputTokens: 20, requests: 1, truncated: false });
    expect(sent[0].url).toBe(`${BASE}/chat/completions`);
    expect(sent[0].headers.Authorization).toBe('Bearer test-key-123');
    expect(sent[0].body.model).toBe('gpt-oss-120b');
    expect(sent[0].body.messages[0]).toEqual({ role: 'system', content: SYS });
    expect(sent[0].body.stream).toBe(false);
    // SambaCloud returns HTTP 400 for parameters it does not know: nothing outside this list may be sent.
    expect(Object.keys(sent[0].body).sort()).toEqual(['max_tokens', 'messages', 'model', 'stream', 'temperature']);
  });
  it('the model, base URL and reasoning effort are configuration, not code', async () => {
    Object.assign(process.env, { SAMBANOVA_MODEL: 'Meta-Llama-3.3-70B-Instruct', SAMBANOVA_REASONING_EFFORT: 'high' });
    replies.push(() => completion('a'), () => completion('b'));
    await runText(IN);
    expect(sent[0].body.model).toBe('Meta-Llama-3.3-70B-Instruct');
    expect(sent[0].body).not.toHaveProperty('reasoning_effort'); // only sent to gpt-oss models
    process.env.SAMBANOVA_MODEL = 'gpt-oss-120b';
    await runText(IN);
    expect(sent[1].body.reasoning_effort).toBe('high');
  });
  it('clamps max_tokens to the configured output ceiling', async () => {
    process.env.SAMBANOVA_MAX_OUTPUT_TOKENS = '5000';
    replies.push(() => completion('x'));
    await runText({ ...IN, maxTokens: 32000 });
    expect(sent[0].body.max_tokens).toBe(5000);
    delete process.env.SAMBANOVA_MAX_OUTPUT_TOKENS;
  });
  it('refuses oversized input before spending a request', async () => {
    process.env.AI_MAX_INPUT_CHARS = '2000';
    await expect(runText({ ...IN, messages: [{ role: 'user', content: 'x'.repeat(5000) }] })).rejects.toMatchObject({ status: 413, code: 'ai_too_long' });
    expect(sent).toHaveLength(0);
    delete process.env.AI_MAX_INPUT_CHARS;
  });
});

describe('SambaNova provider: streaming', () => {
  it('assembles text across arbitrary chunk boundaries, ignores reasoning fields, reports usage', async () => {
    replies.push(() => sse([
      { choices: [{ delta: { role: 'assistant' } }] },
      { choices: [{ delta: { reasoning: 'thinking privately…' } }] },
      delta('Hello '), delta('wor'), delta('ld.\n'), delta('Second ', 'stop'),
      { choices: [], usage: { prompt_tokens: 50, completion_tokens: 7 } },
      '[DONE]',
    ], 17));
    const events = [];
    for await (const e of streamText(IN)) events.push(e);
    const text = events.filter((e) => e.type === 'delta').map((e) => (e as { text: string }).text).join('');
    expect(text).toBe('Hello world.\nSecond ');
    expect(text).not.toContain('thinking privately');
    expect(events.at(-1)).toMatchObject({ type: 'done', result: { text, model: 'gpt-oss-120b', inputTokens: 50, outputTokens: 7, requests: 1, truncated: false } });
    expect(sent[0].body.stream).toBe(true);
  });
  it('estimates usage when the provider sends none, and flags a cut-off answer', async () => {
    replies.push(() => sse([delta('partial answer', 'length'), '[DONE]']));
    const done = (await (async () => { let d; for await (const e of streamText(IN)) if (e.type === 'done') d = e.result; return d; })())!;
    expect(done.truncated).toBe(true);
    expect(done.inputTokens).toBeGreaterThan(0);
    expect(done.outputTokens).toBeGreaterThan(0);
  });
  it('fails clearly on an empty stream and on an error event mid-stream', async () => {
    replies.push(() => sse(['[DONE]']));
    await expect((async () => { for await (const e of streamText(IN)) void e; })()).rejects.toMatchObject({ code: 'ai_empty' });
    replies.push(() => sse([delta('start'), { error: { message: 'boom' } }]));
    await expect((async () => { for await (const e of streamText(IN)) void e; })()).rejects.toMatchObject({ code: 'ai_stream_error' });
  });
});

describe('SambaNova provider: friendly errors', () => {
  it('429 daily limit: says so, with when it resets', async () => {
    replies.push(() => json({ error: { message: 'rate limit' } }, 429, { 'x-ratelimit-remaining-requests-day': '0', 'x-ratelimit-reset-requests-day': '5h30m' }));
    const e = await fails(runText(IN));
    expect(e).toBeInstanceOf(AiError);
    expect(e).toMatchObject({ status: 429, code: 'ai_rate_limited', retryAfterSeconds: 19800 });
    expect(e.message).toMatch(/daily request limit/);
    expect(e.message).toMatch(/5 h 30 min/);
  });
  it('429 per-minute limit: asks to wait about a minute', async () => {
    replies.push(() => json({ error: { message: 'slow down' } }, 429, { 'x-ratelimit-remaining-requests': '0', 'retry-after': '23' }));
    const e = await fails(runText(IN));
    expect(e.message).toMatch(/last minute/);
    expect(e.message).toMatch(/23 seconds/);
    expect(e.retryAfterSeconds).toBe(23);
  });
  it('429 token allowance', async () => {
    replies.push(() => json({ error: { message: 'tokens per day (TPD) exceeded' } }, 429));
    expect((await fails(runText(IN))).message).toMatch(/token allowance/);
  });
  it('401 -> key problem (503, no key details leaked); 400 context -> too long; 400 other -> shorter input', async () => {
    replies.push(() => json({ error: { message: 'invalid api key test-key-123' } }, 401));
    const e1 = await fails(runText(IN));
    expect(e1).toMatchObject({ status: 503, code: 'ai_auth' });
    expect(e1.message).not.toContain('test-key-123');
    replies.push(() => json({ error: { message: 'maximum context length exceeded' } }, 400));
    expect(await fails(runText(IN))).toMatchObject({ status: 413, code: 'ai_too_long' });
    replies.push(() => json({ error: { message: 'unknown parameter foo' } }, 400));
    expect(await fails(runText(IN))).toMatchObject({ status: 502, code: 'ai_bad_request' });
  });
  it('retries a 5xx once and then succeeds, counting both requests', async () => {
    replies.push(() => json({}, 503), () => completion('ok'));
    const r = await runText(IN);
    expect(r.text).toBe('ok');
    expect(r.requests).toBe(2);
  });
  it('gives up after one retry on repeated 5xx or network errors, with friendly messages', async () => {
    replies.push(() => json({}, 500), () => json({}, 500));
    expect(await fails(runText(IN))).toMatchObject({ status: 503, code: 'ai_unavailable' });
    replies.push(() => { throw new TypeError('fetch failed'); }, () => { throw new TypeError('fetch failed'); });
    expect(await fails(runText(IN))).toMatchObject({ status: 503, code: 'ai_unreachable' });
    replies.push(() => { throw Object.assign(new Error('t'), { name: 'TimeoutError' }); }, () => { throw Object.assign(new Error('t'), { name: 'TimeoutError' }); });
    expect(await fails(runText(IN))).toMatchObject({ code: 'ai_timeout' });
  });
  it('does not retry 429 or 400 (they would not change)', async () => {
    replies.push(() => json({}, 429));
    await runText(IN).catch(() => undefined);
    expect(sent).toHaveLength(1);
  });
  it('parses durations and words them for people', () => {
    expect(parseDuration('45')).toBe(45);
    expect(parseDuration('1m30s')).toBe(90);
    expect(parseDuration('12h3m')).toBe(43380);
    expect(parseDuration('2.5s')).toBe(3);
    expect(parseDuration('soon')).toBeUndefined();
    expect(humanWait(30)).toBe('30 seconds');
    expect(humanWait(600)).toBe('10 minutes');
    expect(humanWait(7500)).toBe('2 h 5 min');
    expect(humanWait(3600)).toBe('1 h');
    expect(humanWait(14399.9)).toBe('4 h'); // never "3 h 60 min"
    expect(humanWait(45 * 60)).toBe('45 minutes');
    expect(humanWait(undefined)).toBe('a little while');
  });
});

describe('JSON output validation', () => {
  const Shape = z.object({ title: z.string(), items: z.array(z.string()), score: z.number().nullable() });
  const good = { title: 'T', items: ['a'], score: null };

  it('asks for the JSON schema (response_format + instructions) and accepts a valid answer', async () => {
    replies.push(() => completion(JSON.stringify(good)));
    const r = await runStructured({ ...IN, kind: 'summary' }, Shape);
    expect(r.data).toEqual(good);
    const rf = sent[0].body.response_format;
    expect(rf.type).toBe('json_schema');
    expect(rf.json_schema.name).toBe('result');
    expect(rf.json_schema.strict).toBe(false); // SambaNova does not enforce strict
    expect(rf.json_schema.schema.properties.title.type).toBe('string');
    expect(rf.json_schema.schema).not.toHaveProperty('$schema');
    expect(sent[0].body.messages[0].content).toMatch(/ONE JSON object only/);
    expect(r.requests).toBe(1);
  });
  it('accepts JSON wrapped in fences or chatter', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('Here you go: {"a":{"b":2}} hope it helps')).toEqual({ a: { b: 2 } });
    expect(() => extractJson('no json here')).toThrow();
  });
  it('repairs once: shows the model exactly what was wrong, and counts both requests', async () => {
    replies.push(() => completion('{"title":"T","items":"not-a-list","score":null}'), () => completion(JSON.stringify(good)));
    const r = await runStructured({ ...IN, kind: 'summary' }, Shape);
    expect(r.data).toEqual(good);
    expect(r.requests).toBe(2);
    expect(r.inputTokens).toBe(200);
    const repair = sent[1].body.messages;
    expect(repair.at(-2).role).toBe('assistant');
    expect(repair.at(-1).content).toMatch(/items: .*could not be used|could not be used: items/);
  });
  it('repairs invalid JSON text too', async () => {
    replies.push(() => completion('{"title": "T", '), () => completion(JSON.stringify(good)));
    expect((await runStructured({ ...IN, kind: 'summary' }, Shape)).data).toEqual(good);
  });
  it('fails clearly when the second answer is still wrong (never returns unvalidated data)', async () => {
    replies.push(() => completion('{"nope":1}'), () => completion('still {not json'));
    const e = await fails(runStructured({ ...IN, kind: 'summary' }, Shape));
    expect(e).toMatchObject({ status: 502, code: 'ai_format' });
    expect(sent).toHaveLength(2);
  });
  it('reports a cut-off answer instead of trying to parse it', async () => {
    replies.push(() => json({ choices: [{ message: { content: '{"title":"T","ite' }, finish_reason: 'length' }], usage: {} }));
    expect(await fails(runStructured({ ...IN, kind: 'summary' }, Shape))).toMatchObject({ status: 422, code: 'ai_truncated' });
    expect(sent).toHaveLength(1);
  });
});

describe('provider selection (no automatic fallback)', () => {
  it('sambanova is the default and needs its key', () => {
    delete process.env.AI_PROVIDER;
    expect(getProvider().name).toBe('sambanova');
    delete process.env.SAMBANOVA_API_KEY;
    expect(() => getProvider()).toThrowError(/SAMBANOVA_API_KEY/);
  });
  it('can be switched by configuration; unknown names are rejected', () => {
    process.env.AI_PROVIDER = 'mock';
    expect(getProvider().name).toBe('mock');
    process.env.AI_PROVIDER = 'anthropic';
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    expect(getProvider().name).toBe('anthropic');
    process.env.AI_PROVIDER = 'nonsense';
    expect(() => getProvider()).toThrow(/AI_PROVIDER/);
    delete process.env.ANTHROPIC_API_KEY;
  });
  it('when SambaNova fails, nothing else is called', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-should-never-be-used';
    replies.push(() => json({}, 500), () => json({}, 500));
    await runText(IN).catch(() => undefined);
    expect(sent.every((s) => s.url.startsWith(BASE))).toBe(true);
    delete process.env.ANTHROPIC_API_KEY;
  });
});

describe('Ollama Cloud provider (HTTP mocked)', () => {
  const KEY = 'ollama-test-key-456';
  const OBase = 'https://ollama.com/v1';
  let A: Who;
  beforeAll(async () => { await setup(); A = await signIn('OllamaTester'); });
  beforeEach(() => {
    Object.assign(process.env, { AI_PROVIDER: 'ollama', OLLAMA_API_KEY: KEY });
    for (const k of ['OLLAMA_MODEL', 'OLLAMA_BASE_URL', 'OLLAMA_MAX_OUTPUT_TOKENS', 'AI_MAX_INPUT_CHARS']) delete process.env[k];
  });
  afterEach(() => { for (const k of ['OLLAMA_API_KEY', 'OLLAMA_MODEL', 'OLLAMA_BASE_URL', 'OLLAMA_MAX_OUTPUT_TOKENS', 'AI_MAX_INPUT_CHARS']) delete process.env[k]; });

  it('uses the defaults (gpt-oss:120b at https://ollama.com/v1) and sends only standard parameters', async () => {
    replies.push(() => completion('hi'));
    const r = await runText(IN);
    expect(r).toMatchObject({ text: 'hi', model: 'gpt-oss:120b', inputTokens: 100, outputTokens: 20, requests: 1, truncated: false });
    expect(sent[0].url).toBe(`${OBase}/chat/completions`);
    expect(sent[0].headers.Authorization).toBe(`Bearer ${KEY}`);
    expect(sent[0].body.model).toBe('gpt-oss:120b');
    expect(sent[0].body.messages[0]).toEqual({ role: 'system', content: SYS });
    expect(Object.keys(sent[0].body).sort()).toEqual(['max_tokens', 'messages', 'model', 'stream', 'temperature']);
    expect(getProvider().name).toBe('ollama');
  });
  it('model, base URL and output ceiling are configuration', async () => {
    Object.assign(process.env, { OLLAMA_MODEL: 'other:model', OLLAMA_BASE_URL: 'https://ollama.example/v1/', OLLAMA_MAX_OUTPUT_TOKENS: '5000' });
    replies.push(() => completion('x'));
    await runText({ ...IN, maxTokens: 32000 });
    expect(sent[0].url).toBe('https://ollama.example/v1/chat/completions');
    expect(sent[0].body.model).toBe('other:model');
    expect(sent[0].body.max_tokens).toBe(5000);
  });
  it('JSON answers rely on the prompt and validation: no response_format is sent, fenced JSON is accepted, one repair is allowed', async () => {
    const Shape = z.object({ title: z.string(), items: z.array(z.string()) });
    replies.push(() => completion('```json\n{"title":"T","items":["a"]}\n```'));
    const ok = await runStructured({ ...IN, kind: 'summary' }, Shape);
    expect(ok.data).toEqual({ title: 'T', items: ['a'] });
    expect(sent[0].body).not.toHaveProperty('response_format');
    expect(sent[0].body.messages[0].content).toMatch(/ONE JSON object only/);
    replies.push(() => completion('{"title":1}'), () => completion('{"title":"T2","items":[]}'));
    const fixed = await runStructured({ ...IN, kind: 'summary' }, Shape);
    expect(fixed.data.title).toBe('T2');
    expect(fixed.requests).toBe(2);
    replies.push(() => completion('nope'), () => completion('still nope'));
    expect(await fails(runStructured({ ...IN, kind: 'summary' }, Shape))).toMatchObject({ code: 'ai_format' });
  });
  it('streams only the answer: reasoning fields are ignored, chunks may split anywhere, usage is reported', async () => {
    replies.push(() => sse([
      { choices: [{ delta: { reasoning: 'thinking about it' }, finish_reason: null }] },
      delta('Hel'), delta('lo '), delta('there', 'stop'),
      { choices: [], usage: { prompt_tokens: 11, completion_tokens: 3 } }, '[DONE]',
    ], 13));
    const events: string[] = []; let done: any; // eslint-disable-line @typescript-eslint/no-explicit-any
    for await (const e of streamText(IN)) { if (e.type === 'delta') events.push(e.text); else done = e.result; }
    expect(events.join('')).toBe('Hello there');
    expect(events.join('')).not.toMatch(/thinking/);
    expect(done).toMatchObject({ text: 'Hello there', model: 'gpt-oss:120b', inputTokens: 11, outputTokens: 3, requests: 1, truncated: false });
    expect(sent[0].body.stream).toBe(true);
  });
  it('friendly errors: key rejected (no key leaked), plan, model, usage limit, too long, bad request', async () => {
    replies.push(() => json({ error: { message: `invalid api key ${KEY}` } }, 401));
    const e1 = await fails(runText(IN));
    expect(e1).toMatchObject({ status: 503, code: 'ai_auth' });
    expect(e1.message).not.toContain(KEY);
    replies.push(() => json({ error: { message: 'upgrade' } }, 402));
    expect(await fails(runText(IN))).toMatchObject({ status: 503, code: 'ai_auth' });
    replies.push(() => json({ error: { message: 'model not found' } }, 404));
    expect(await fails(runText(IN))).toMatchObject({ status: 503, code: 'ai_model_unavailable' });
    replies.push(() => json({ error: { message: 'maximum context length exceeded' } }, 400));
    expect(await fails(runText(IN))).toMatchObject({ status: 413, code: 'ai_too_long' });
    replies.push(() => json({ error: { message: 'unknown field foo' } }, 400));
    expect(await fails(runText(IN))).toMatchObject({ status: 502, code: 'ai_bad_request' });
  });
  it('429 reports the usage limit with when to retry, and is never retried', async () => {
    replies.push(() => json({ error: { message: 'weekly usage limit reached' } }, 429, { 'retry-after': '30' }));
    const e = await fails(runText(IN));
    expect(e).toMatchObject({ status: 429, code: 'ai_rate_limited', retryAfterSeconds: 30 });
    expect(e.message).toMatch(/usage limit/);
    expect(e.message).toMatch(/30 seconds/);
    replies.push(() => json({}, 429));
    expect((await fails(runText(IN))).message).toMatch(/try again later/);
    expect(sent).toHaveLength(2);
  });
  it('retries a 5xx once (counting both requests) and gives up after the second failure', async () => {
    vi.useFakeTimers();
    replies.push(() => json({}, 503), () => completion('second time'));
    const p = runText(IN);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await p).toMatchObject({ text: 'second time', requests: 2 });
    replies.push(() => json({}, 500), () => json({}, 500));
    const q = fails(runText(IN));
    await vi.advanceTimersByTimeAsync(1000);
    expect(await q).toMatchObject({ status: 503, code: 'ai_unavailable' });
  });
  it('a missing key is reported as not configured and names the variable (never a crash)', async () => {
    delete process.env.OLLAMA_API_KEY;
    expect(() => getProvider()).toThrowError(/OLLAMA_API_KEY/);
    const r = await call(aiTest.POST, 'POST', '/api/ai/test', { who: A, body: {} });
    expect(r.status).toBe(503);
    expect(r.data.error).toMatch(/OLLAMA_API_KEY/);
  });
  it('defaults: no request pacing counted by this site, and a 300k-character input ceiling that is enforced before any request', async () => {
    for (const k of ['AI_LIMIT_RPM', 'AI_LIMIT_RPD', 'AI_LIMIT_TPD']) delete process.env[k];
    const { aiConfig } = await import('@/lib/config');
    expect(aiConfig().limits).toEqual({ rpm: 0, rpd: 0, tpd: 0 });
    expect(aiConfig().maxInputChars).toBe(300000);
    expect(aiConfig().ollama).toMatchObject({ model: 'gpt-oss:120b', baseUrl: OBase });
    const db = await getDb();
    await recordUsage(db, A.id, 'chat', 'gpt-oss:120b', 1_000_000, 1_000_000, 100);
    await expect(assertProviderCapacity(db)).resolves.toBeUndefined(); // sambanova's free-tier counting does not apply
    const e = await fails(runText({ ...IN, messages: [{ role: 'user', content: 'x'.repeat(301_000) }] }));
    expect(e).toMatchObject({ status: 413, code: 'ai_too_long' });
    expect(sent).toHaveLength(0);
  });
  it('no automatic fallback: other vendors are never called when Ollama fails', async () => {
    Object.assign(process.env, { SAMBANOVA_API_KEY: 'sn-should-never-be-used', ANTHROPIC_API_KEY: 'sk-should-never-be-used' });
    vi.useFakeTimers();
    replies.push(() => json({}, 500), () => json({}, 500));
    const p = fails(runText(IN));
    await vi.advanceTimersByTimeAsync(1000);
    await p;
    expect(sent.every((s) => s.url.startsWith(OBase))).toBe(true);
    delete process.env.ANTHROPIC_API_KEY;
  });
  it('"Test AI connection" and health show Ollama, mark it real, and never include the key', async () => {
    replies.push(() => completion('OK'));
    const r = await call(aiTest.POST, 'POST', '/api/ai/test', { who: A, body: {} });
    expect(r.status).toBe(200);
    expect(r.data).toMatchObject({ ok: true, provider: 'ollama', model: 'gpt-oss:120b', reply: 'OK', real: true });
    const h = await call(health.GET as never, 'GET', '/api/health');
    expect(h.data.ai).toEqual({ provider: 'ollama', configured: true });
    expect(JSON.stringify([r.data, h.data])).not.toContain(KEY);
    delete process.env.OLLAMA_API_KEY;
    expect((await call(health.GET as never, 'GET', '/api/health')).data.ai).toEqual({ provider: 'ollama', configured: false });
  });
  it('chat streams Ollama text through the real route with unverified citations removed', async () => {
    const events = async (res: Response) => (await res.text()).trim().split('\n\n').map((b) => ({ event: /^event: (.*)$/m.exec(b)![1], data: JSON.parse(/^data: (.*)$/m.exec(b)![1]) }));
    replies.push(() => sse([delta('The rule is settled.\nHeld in AI'), delta('R 1973 SC 14'), delta('61 by the Court.\nDone'), delta('.', 'stop'), '[DONE]'], 9));
    const r = await call(chat.POST, 'POST', '/api/chat', { who: A, raw: true, body: { consent: true, message: 'What is the rule?' } });
    const ev = await events(r.res);
    const streamed = ev.filter((e) => e.event === 'delta').map((e) => e.data.text).join('');
    expect(streamed).not.toMatch(/AIR|1973|1461/);
    expect(streamed).toContain('[citation withheld');
    expect(ev.at(-1)!.event).toBe('done');
    expect(sent[0].url).toBe(`${OBase}/chat/completions`);
  });
});

describe('through the real routes (HTTP mocked)', () => {
  let A: Who;
  beforeAll(async () => { await setup(); A = await signIn('Asha'); });
  beforeEach(() => { Object.assign(process.env, { AI_PROVIDER: 'sambanova', SAMBANOVA_API_KEY: 'test-key-123', SAMBANOVA_BASE_URL: BASE, AI_LIMIT_RPM: '0', AI_LIMIT_RPD: '0', AI_LIMIT_TPD: '0' }); });
  const events = async (res: Response) => (await res.text()).trim().split('\n\n').map((b) => ({ event: /^event: (.*)$/m.exec(b)![1], data: JSON.parse(/^data: (.*)$/m.exec(b)![1]) }));

  it('chat streams SambaNova text with citations removed even when split across chunks', async () => {
    replies.push(() => sse([delta('The rule is settled.\nHeld in AI'), delta('R 1973 SC 14'), delta('61 by the Court.\nDone'), delta('.', 'stop'), '[DONE]'], 9));
    const r = await call(chat.POST, 'POST', '/api/chat', { who: A, raw: true, body: { consent: true, message: 'What is the rule?' } });
    const ev = await events(r.res);
    const streamed = ev.filter((e) => e.event === 'delta').map((e) => e.data.text).join('');
    expect(streamed).not.toMatch(/AIR|1973|1461/);
    expect(streamed).toContain('[citation withheld');
    const done = ev.at(-1)!;
    expect(done.event).toBe('done');
    expect(done.data.text).toBe('The rule is settled.\nHeld in [citation withheld: not found in your documents] by the Court.\nDone.');
    expect(done.data.flags[0]).toMatchObject({ kind: 'citation' });
  });
  it('chat shows the friendly rate-limit message as a stream error (not a crash)', async () => {
    replies.push(() => json({}, 429, { 'x-ratelimit-remaining-requests-day': '0', 'x-ratelimit-reset-requests-day': '3600' }));
    const r = await call(chat.POST, 'POST', '/api/chat', { who: A, raw: true, body: { consent: true, message: 'again?' } });
    const ev = await events(r.res);
    expect(ev.at(-1)!.event).toBe('error');
    expect(ev.at(-1)!.data.error).toMatch(/daily request limit.*1 h/);
  });
  it('research (structured) returns 429 with Retry-After and a friendly message', async () => {
    replies.push(() => json({}, 429, { 'retry-after': '41', 'x-ratelimit-remaining-requests': '0' }));
    const r = await call(research.POST, 'POST', '/api/research', { who: A, body: { consent: true, question: 'Is this lawful in India?' } });
    expect(r.status).toBe(429);
    expect(r.res.headers.get('retry-after')).toBe('41');
    expect(r.data.error).toMatch(/Please wait 41 seconds/);
  });
  it('research removes unverified citations from the memo', async () => {
    const memo = { restated_question: 'q', short_answer: 'Yes, see AIR 1973 SC 1461.', issues: [], provisions: [], authorities: [{ name: 'Foo v. Bar', kind: 'case', basis: 'provided_source', proposition: 'p', verify: 'v' }], arguments_for: [], arguments_against: [], practical_steps: [], missing_information: [], caveats: [] };
    replies.push(() => completion(JSON.stringify(memo)));
    const r = await call(research.POST, 'POST', '/api/research', { who: A, body: { consent: true, question: 'Is the basic structure doctrine part of Indian law?' } });
    expect(r.status).toBe(200);
    expect(JSON.stringify(r.data.result)).not.toContain('AIR 1973');
    expect(r.data.result.short_answer).toContain('[citation withheld');
    expect(r.data.result.authorities[0]).toMatchObject({ basis: 'model_memory', verified: false, downgraded: true });
  });
  it('translation works through the provider and records one usage row per request', async () => {
    replies.push(() => completion('{"translation":"याचिका खारिज की जाती है।","glossary":[],"warnings":[]}'));
    const r = await call(translate.POST, 'POST', '/api/translate', { who: A, body: { consent: true, text: 'The petition is dismissed.', from: 'english', to: 'hindi' } });
    expect(r.data.translation).toBe('याचिका खारिज की जाती है।');
    expect(sent[0].body.messages[1].content).toMatch(/Translate from English into Hindi/);
  });
});

describe('"Test AI connection" and health', () => {
  let A: Who;
  beforeAll(async () => { await setup(); A = await signIn('Tester'); });
  beforeEach(() => { Object.assign(process.env, { AI_PROVIDER: 'sambanova', SAMBANOVA_API_KEY: 'test-key-123', SAMBANOVA_BASE_URL: BASE, AI_LIMIT_RPM: '0', AI_LIMIT_RPD: '0', AI_LIMIT_TPD: '0' }); });

  it('proves a real provider answered: provider, model, latency, and that it is real', async () => {
    replies.push(() => completion('OK'));
    const r = await call(aiTest.POST, 'POST', '/api/ai/test', { who: A, body: {} });
    expect(r.status).toBe(200);
    expect(r.data).toMatchObject({ ok: true, provider: 'sambanova', model: 'gpt-oss-120b', reply: 'OK', real: true });
    expect(sent).toHaveLength(1);
  });
  it('says plainly when it is only the mock', async () => {
    process.env.AI_PROVIDER = 'mock';
    const r = await call(aiTest.POST, 'POST', '/api/ai/test', { who: A, body: {} });
    expect(r.data).toMatchObject({ provider: 'mock', real: false });
  });
  it('requires sign-in, and shows a friendly error (no key) when the key is rejected', async () => {
    expect((await call(aiTest.POST, 'POST', '/api/ai/test', { body: {} })).status).toBe(401);
    replies.push(() => json({ error: { message: 'bad key test-key-123' } }, 401));
    const r = await call(aiTest.POST, 'POST', '/api/ai/test', { who: A, body: {} });
    expect(r.status).toBe(503);
    expect(JSON.stringify(r.data)).not.toContain('test-key-123');
    expect(r.data.error).toMatch(/key was rejected/);
  });
  it('a missing key is reported as not configured (503), not a crash', async () => {
    delete process.env.SAMBANOVA_API_KEY;
    const r = await call(aiTest.POST, 'POST', '/api/ai/test', { who: A, body: {} });
    expect(r.status).toBe(503);
    expect(r.data.error).toMatch(/SAMBANOVA_API_KEY/);
  });
  it('health reports provider + whether a key is set, never the key', async () => {
    const h = await call(health.GET as never, 'GET', '/api/health');
    expect(h.data.ai).toEqual({ provider: 'sambanova', configured: true });
    delete process.env.SAMBANOVA_API_KEY;
    expect((await call(health.GET as never, 'GET', '/api/health')).data.ai).toEqual({ provider: 'sambanova', configured: false });
    process.env.AI_PROVIDER = 'bogus';
    expect((await call(health.GET as never, 'GET', '/api/health')).data.ai).toEqual({ provider: 'invalid', configured: false });
    expect(JSON.stringify(h.data)).not.toContain('test-key-123');
  });
});

describe('free-tier pacing (shared by everyone on the site)', () => {
  let db: Awaited<ReturnType<typeof setup>>['db'];
  let advocateId: string;
  beforeAll(async () => { ({ db } = await setup()); advocateId = (await signIn('Pace')).id; });
  beforeEach(async () => {
    await db.delete(schema.aiUsage);
    Object.assign(process.env, { AI_PROVIDER: 'sambanova', SAMBANOVA_API_KEY: 'k', AI_LIMIT_RPM: '3', AI_LIMIT_RPD: '5', AI_LIMIT_TPD: '1000' });
  });
  const add = (ageMs: number, tokens = 0) => db.insert(schema.aiUsage).values({ advocateId, kind: 'chat', model: 'm', inputTokens: tokens, outputTokens: 0, createdAt: new Date(Date.now() - ageMs) });

  it('allows requests under every limit', async () => {
    await add(10_000); await add(20_000);
    await expect(assertProviderCapacity(db)).resolves.toBeUndefined();
  });
  it('per-minute limit: names the limit and how long to wait', async () => {
    await add(10_000); await add(20_000); await add(30_000);
    const e = await fails(assertProviderCapacity(db));
    expect(e).toMatchObject({ status: 429, code: 'ai_rate_limited' });
    expect(e.message).toMatch(/limit is 3 per minute/);
    expect(e.retryAfterSeconds).toBeGreaterThanOrEqual(29);
    expect(e.retryAfterSeconds).toBeLessThanOrEqual(31);
  });
  it('daily limit: says when the oldest request ages out', async () => {
    for (const h of [20, 18, 10, 5, 2]) await add(h * 3_600_000);
    const e = await fails(assertProviderCapacity(db));
    expect(e.message).toMatch(/daily limit \(5 requests per day, shared by everyone/);
    expect(e.message).toMatch(/4 h/); // the 20 h-old request frees a slot in ~4 h
    expect(e.retryAfterSeconds).toBeGreaterThan(3.9 * 3600);
  });
  it('token allowance', async () => {
    await add(2 * 3_600_000, 700); await add(3_600_000, 400);
    const e = await fails(assertProviderCapacity(db));
    expect(e.message).toMatch(/token allowance \(1,000 tokens\)/);
  });
  it('limits of 0 switch checks off, other advocates count too, and the mock provider is exempt', async () => {
    process.env.AI_LIMIT_RPM = '0'; process.env.AI_LIMIT_RPD = '0'; process.env.AI_LIMIT_TPD = '0';
    for (let i = 0; i < 9; i++) await add(1000 + i);
    await expect(assertProviderCapacity(db)).resolves.toBeUndefined();
    process.env.AI_LIMIT_RPM = '3';
    await expect(assertProviderCapacity(db)).rejects.toBeInstanceOf(AiError);
    process.env.AI_PROVIDER = 'mock';
    await expect(assertProviderCapacity(db)).resolves.toBeUndefined();
  });
  it('recordUsage writes one row per provider request (tokens on the first)', async () => {
    await recordUsage(db, advocateId, 'research', 'gpt-oss-120b', 500, 100, 2);
    const rows = await db.select().from(schema.aiUsage);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.inputTokens).sort((a, b) => a - b)).toEqual([0, 500]);
  });
  it('free-tier defaults apply to sambanova unless overridden', async () => {
    for (const k of ['AI_LIMIT_RPM', 'AI_LIMIT_RPD', 'AI_LIMIT_TPD', 'SAMBANOVA_BASE_URL']) delete process.env[k];
    const { aiConfig } = await import('@/lib/config');
    expect(aiConfig().limits).toEqual({ rpm: 20, rpd: 20, tpd: 200000 });
    expect(aiConfig().sambanova).toMatchObject({ model: 'gpt-oss-120b', baseUrl: 'https://api.sambanova.ai/v1' });
  });
});
