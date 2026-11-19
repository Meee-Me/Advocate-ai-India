// Live check of your SambaNova key, from your own computer (never paste the key into a chat):
//   SAMBANOVA_API_KEY=... node scripts/ai-smoke.mjs          (or: node --env-file=.env.local scripts/ai-smoke.mjs)
// Uses only plain HTTP calls to the documented API. It sends 4 requests (of the free plan's 20 per day).
const key = process.env.SAMBANOVA_API_KEY;
const base = (process.env.SAMBANOVA_BASE_URL || 'https://api.sambanova.ai/v1').replace(/\/+$/, '');
const model = process.env.SAMBANOVA_MODEL || 'gpt-oss-120b';
if (!key) { console.error('Set SAMBANOVA_API_KEY first.'); process.exit(2); }
let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) failed++; };
const safeFetch = async (url, init) => {
  try { return await fetch(url, init); } catch (e) {
    console.error(`Could not reach ${new URL(url).host}: ${e?.cause?.code ?? e?.message ?? e}. Check your internet connection or proxy (Node: NODE_USE_ENV_PROXY=1).`);
    process.exit(2);
  }
};
const post = (body) => safeFetch(`${base}/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` }, body: JSON.stringify(body) });

const models = await safeFetch(`${base}/models`, { headers: { authorization: `Bearer ${key}` } });
const list = models.ok ? (await models.json()).data?.map((m) => m.id) ?? [] : [];
check(models.ok, `key accepted by /models (HTTP ${models.status})`);
check(list.includes(model), `model "${model}" is available to this key (available: ${list.join(', ') || 'none'})`);

const plain = await post({ model, messages: [{ role: 'user', content: 'Reply with exactly: OK' }], max_tokens: 300 });
const pj = await plain.json().catch(() => ({}));
check(plain.ok && /OK/.test(pj.choices?.[0]?.message?.content ?? ''), `plain completion works (HTTP ${plain.status})`);
for (const h of ['x-ratelimit-limit-requests', 'x-ratelimit-remaining-requests', 'x-ratelimit-limit-requests-day', 'x-ratelimit-remaining-requests-day']) console.log(`     ${h}: ${plain.headers.get(h) ?? '(not sent)'}`);

const st = await post({ model, stream: true, messages: [{ role: 'user', content: 'Count from 1 to 5, one number per line.' }], max_tokens: 400 });
let text = '', chunks = 0;
if (st.ok && st.body) {
  const dec = new TextDecoder(); let buf = '';
  for await (const part of st.body) { buf += dec.decode(part, { stream: true }); let i; while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (line.startsWith('data:') && !line.includes('[DONE]')) { try { const d = JSON.parse(line.slice(5))?.choices?.[0]?.delta?.content; if (d) { text += d; chunks++; } } catch {} } } }
}
check(st.ok && chunks > 1 && /1/.test(text) && /5/.test(text), `streaming works (HTTP ${st.status}, ${chunks} chunks)`);

const js = await post({ model, messages: [{ role: 'user', content: 'Give a title and two items about contracts.' }], max_tokens: 800,
  response_format: { type: 'json_schema', json_schema: { name: 'result', strict: false, schema: { type: 'object', properties: { title: { type: 'string' }, items: { type: 'array', items: { type: 'string' } } }, required: ['title', 'items'], additionalProperties: false } } } });
const jj = await js.json().catch(() => ({}));
let parsed = null; try { parsed = JSON.parse(jj.choices?.[0]?.message?.content ?? ''); } catch {}
check(js.ok && typeof parsed?.title === 'string' && Array.isArray(parsed?.items), `JSON-schema output works (HTTP ${js.status})`);
console.log(failed ? `\n${failed} check(s) failed` : '\nSambaNova key and model work for plain, streaming and JSON output.');
process.exit(failed ? 1 : 0);
