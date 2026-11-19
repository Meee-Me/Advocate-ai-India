// Live check of your AI key, from your own computer (never paste the key into a chat):
//   AI_PROVIDER=ollama OLLAMA_API_KEY=... node scripts/ai-smoke.mjs      (or: node --env-file=.env.local scripts/ai-smoke.mjs)
//   AI_PROVIDER=sambanova SAMBANOVA_API_KEY=... node scripts/ai-smoke.mjs   (default provider: sambanova)
// Uses only plain HTTP calls to the documented OpenAI-compatible API. It sends 3-4 requests.
const provider = (process.env.AI_PROVIDER || 'sambanova').toLowerCase();
const P = {
  sambanova: { keyEnv: 'SAMBANOVA_API_KEY', base: process.env.SAMBANOVA_BASE_URL || 'https://api.sambanova.ai/v1', model: process.env.SAMBANOVA_MODEL || 'gpt-oss-120b', schemaOutput: true },
  // Ollama Cloud: JSON comes from the prompt (no response_format), exactly as the app asks for it.
  ollama: { keyEnv: 'OLLAMA_API_KEY', base: process.env.OLLAMA_BASE_URL || 'https://ollama.com/v1', model: process.env.OLLAMA_MODEL || 'gpt-oss:120b', schemaOutput: false },
}[provider];
if (!P) { console.error('AI_PROVIDER must be "sambanova" or "ollama" for this script.'); process.exit(2); }
const key = process.env[P.keyEnv];
const base = P.base.replace(/\/+$/, '');
const model = P.model;
if (!key) { console.error(`Set ${P.keyEnv} first.`); process.exit(2); }
let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) failed++; };
const safeFetch = async (url, init) => {
  try { return await fetch(url, init); } catch (e) {
    console.error(`Could not reach ${new URL(url).host}: ${e?.cause?.code ?? e?.message ?? e}. Check your internet connection or proxy (Node: NODE_USE_ENV_PROXY=1).`);
    process.exit(2);
  }
};
const post = (body) => safeFetch(`${base}/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` }, body: JSON.stringify(body) });
console.log(`Provider: ${provider}, model: ${model}, endpoint: ${new URL(base).host}`);

const models = await safeFetch(`${base}/models`, { headers: { authorization: `Bearer ${key}` } });
const list = models.ok ? (await models.json()).data?.map((m) => m.id) ?? [] : [];
if (provider === 'ollama' && !models.ok) console.log(`warn /models not available (HTTP ${models.status}); judging the key by the completion calls below`);
else {
  check(models.ok, `key accepted by /models (HTTP ${models.status})`);
  check(list.includes(model), `model "${model}" is available to this key (available: ${list.join(', ') || 'none'})`);
}

const plain = await post({ model, messages: [{ role: 'user', content: 'Reply with exactly: OK' }], max_tokens: 300 });
const pj = await plain.json().catch(() => ({}));
check(plain.ok && /OK/.test(pj.choices?.[0]?.message?.content ?? ''), `plain completion works (HTTP ${plain.status})`);
if (provider === 'sambanova') for (const h of ['x-ratelimit-limit-requests', 'x-ratelimit-remaining-requests', 'x-ratelimit-limit-requests-day', 'x-ratelimit-remaining-requests-day']) console.log(`     ${h}: ${plain.headers.get(h) ?? '(not sent)'}`);

const st = await post({ model, stream: true, messages: [{ role: 'user', content: 'Count from 1 to 5, one number per line.' }], max_tokens: 400 });
let text = '', chunks = 0;
if (st.ok && st.body) {
  const dec = new TextDecoder(); let buf = '';
  for await (const part of st.body) { buf += dec.decode(part, { stream: true }); let i; while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (line.startsWith('data:') && !line.includes('[DONE]')) { try { const d = JSON.parse(line.slice(5))?.choices?.[0]?.delta?.content; if (d) { text += d; chunks++; } } catch {} } } }
}
check(st.ok && chunks > 1 && /1/.test(text) && /5/.test(text), `streaming works (HTTP ${st.status}, ${chunks} chunks)`);

const shape = { type: 'object', properties: { title: { type: 'string' }, items: { type: 'array', items: { type: 'string' } } }, required: ['title', 'items'], additionalProperties: false };
const js = await post({
  model, max_tokens: 800,
  messages: [
    ...(P.schemaOutput ? [] : [{ role: 'system', content: `Reply with ONE JSON object only, matching this JSON Schema exactly. No markdown fences, no other text.\n${JSON.stringify(shape)}` }]),
    { role: 'user', content: 'Give a title and two items about contracts.' },
  ],
  ...(P.schemaOutput ? { response_format: { type: 'json_schema', json_schema: { name: 'result', strict: false, schema: shape } } } : {}),
});
const jj = await js.json().catch(() => ({}));
const raw = (jj.choices?.[0]?.message?.content ?? '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
let parsed = null; try { parsed = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)); } catch {}
check(js.ok && typeof parsed?.title === 'string' && Array.isArray(parsed?.items), `JSON output works (${P.schemaOutput ? 'schema mode' : 'prompted JSON'}, HTTP ${js.status})`);
console.log(failed ? `\n${failed} check(s) failed` : `\n${provider} key and model work for plain, streaming and JSON output.`);
process.exit(failed ? 1 : 0);
