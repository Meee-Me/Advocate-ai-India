/**
 * LIVE tests against the real SambaNova API, through this app's own provider code.
 *   - The wrong-key test needs no key and spends nothing (it checks the real 401 answer is turned into a friendly error).
 *   - The real-key tests run only when SAMBANOVA_API_KEY is set:
 *       SAMBANOVA_API_KEY=... LIVE_AI=1 npx vitest run tests/live-sambanova.test.ts
 *     They send about 5 requests (the free plan allows 20 per day).
 * Skipped by default so the normal test run never needs the network.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { runStructured, runText, streamText } from '@/lib/ai/client';
import { guard } from '@/lib/legal/citation-guard';

const live = process.env.LIVE_AI === '1';
const key = process.env.SAMBANOVA_API_KEY ?? '';
const IN = { kind: 'chat', system: 'You are a concise assistant.', messages: [{ role: 'user' as const, content: 'Reply with exactly: OK' }], maxTokens: 400 };

describe.skipIf(!live)('real SambaNova API: wrong key', () => {
  beforeEach(() => { Object.assign(process.env, { AI_PROVIDER: 'sambanova', SAMBANOVA_API_KEY: 'definitely-not-a-real-key', AI_LIMIT_RPM: '0', AI_LIMIT_RPD: '0', AI_LIMIT_TPD: '0' }); delete process.env.SAMBANOVA_BASE_URL; });
  it('turns the real 401 into a friendly error that does not leak the key', async () => {
    const e = await runText(IN).then(() => null, (x) => x);
    expect(e).toMatchObject({ status: 503, code: 'ai_auth' });
    expect(e.message).toMatch(/key was rejected/);
    expect(e.message).not.toContain('definitely-not-a-real-key');
  });
});

describe.skipIf(!live || !key)('real SambaNova API: your key', () => {
  beforeEach(() => { Object.assign(process.env, { AI_PROVIDER: 'sambanova', SAMBANOVA_API_KEY: key, AI_LIMIT_RPM: '0', AI_LIMIT_RPD: '0', AI_LIMIT_TPD: '0' }); });
  it('plain completion', async () => {
    const r = await runText(IN);
    console.log('LIVE plain:', r.model, JSON.stringify(r.text.slice(0, 60)), `${r.inputTokens}/${r.outputTokens} tokens`);
    expect(r.text).toMatch(/OK/);
    expect(r.model).toBeTruthy();
  }, 120_000);
  it('streaming', async () => {
    let chunks = 0; let text = '';
    for await (const e of streamText({ ...IN, messages: [{ role: 'user', content: 'Count from 1 to 5, one number per line.' }] })) {
      if (e.type === 'delta') { chunks++; text += e.text; }
    }
    expect(chunks).toBeGreaterThan(1);
    expect(text).toMatch(/1[\s\S]*5/);
  }, 120_000);
  it('JSON-schema output, validated', async () => {
    const S = z.object({ title: z.string(), items: z.array(z.string()) });
    const r = await runStructured({ ...IN, kind: 'summary', messages: [{ role: 'user', content: 'Give a title and two items about contract law.' }], maxTokens: 2000 }, S);
    console.log('LIVE structured:', JSON.stringify(r.data).slice(0, 120), `requests=${r.requests}`);
    expect(r.data.items.length).toBeGreaterThan(0);
  }, 120_000);
  it('does the model invent citations? The safeguard removes them either way', async () => {
    const r = await runText({ kind: 'chat', system: 'You are an Indian legal assistant.', messages: [{ role: 'user', content: 'Cite one Supreme Court case on the basic structure doctrine with its AIR citation.' }], maxTokens: 1500 });
    const g = guard(r.text, ['Cite one Supreme Court case on the basic structure doctrine with its AIR citation.']);
    console.log('LIVE raw answer:', r.text.slice(0, 300).replace(/\n/g, ' '));
    console.log('LIVE after safeguard:', g.text.slice(0, 300).replace(/\n/g, ' '), `| flags: ${g.flags.map((f) => f.kind).join(',')}`);
    expect(g.text).not.toMatch(/\bAIR\s+(19|20)\d{2}\s+SC\s+\d+/);
  }, 120_000);
});
