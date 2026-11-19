import { api, readBody } from '@/lib/http';
import { streamText } from '@/lib/ai/client';
import { systemPrompt } from '@/lib/ai/prompts';
import { matterContext } from '@/lib/ai/context';
import { guard, StreamGuard } from '@/lib/legal/citation-guard';
import { citationMode } from '@/lib/config';
import { addMessage, assertAiQuota, conversationMessages, createConversation, getConversation, recordUsage } from '@/lib/db/repos/work';
import { chatInput } from '@/lib/validation';

export const maxDuration = 300;

const MAX_HISTORY_CHARS = 200_000;
const enc = new TextEncoder();
const sse = (event: string, data: unknown) => enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

/** POST /api/chat: streams the answer as server-sent events (meta, delta, done | error). */
export const POST = api(async ({ req, db, advocateId }) => {
  const body = await readBody(req, chatInput);
  await assertAiQuota(db, advocateId);
  const conv = body.conversationId
    ? await getConversation(db, advocateId, body.conversationId)
    : await createConversation(db, advocateId, body.message, body.caseId);
  await addMessage(db, advocateId, conv.id, 'user', body.message);

  const history = await conversationMessages(db, advocateId, conv.id);
  const matter = await matterContext(db, advocateId, conv.caseId);
  // Keep the newest turns that fit.
  const kept: typeof history = [];
  let size = 0;
  for (const m of [...history].reverse()) {
    size += m.content.length;
    if (size > MAX_HISTORY_CHARS && kept.length) break;
    kept.unshift(m);
  }
  // What the advocate actually said or supplied is the only thing that can verify an authority.
  const sources = [matter ?? '', ...history.filter((m) => m.role === 'user').map((m) => m.content)];

  const opts = { inline: true, citations: citationMode() } as const;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(sse('meta', { conversationId: conv.id }));
      // Unverified citations are removed before they are shown, so text is released a line at a time.
      const sg = new StreamGuard(sources, opts);
      try {
        for await (const e of streamText({
          kind: 'chat',
          system: systemPrompt('chat', { matter }),
          messages: kept.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
          effort: 'medium',
          maxTokens: 16000,
        })) {
          if (e.type === 'delta') {
            const safe = sg.push(e.text);
            if (safe) controller.enqueue(sse('delta', { text: safe }));
          } else {
            const tail = sg.flush();
            if (tail) controller.enqueue(sse('delta', { text: tail }));
            const g = guard(e.result.text, sources, opts);
            const saved = await addMessage(db, advocateId, conv.id, 'assistant', g.text, { flags: g.flags, model: e.result.model });
            await recordUsage(db, advocateId, 'chat', e.result.model, e.result.inputTokens, e.result.outputTokens, e.result.requests);
            controller.enqueue(sse('done', { messageId: saved.id, text: g.text, flags: g.flags, truncated: e.result.truncated }));
          }
        }
      } catch (error) {
        const msg = error instanceof Error && 'status' in error ? error.message : 'Something went wrong. Please try again.';
        console.error('Chat stream failed:', error instanceof Error ? error.name : 'unknown');
        controller.enqueue(sse('error', { error: msg }));
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store, no-transform', 'X-Accel-Buffering': 'no' } });
});
