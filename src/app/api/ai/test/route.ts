import { api } from '@/lib/http';
import { runText } from '@/lib/ai/client';
import { activeModel, aiConfig } from '@/lib/config';
import { assertAiQuota, recordUsage } from '@/lib/db/repos/work';

/**
 * "Test AI connection": one tiny real request to the configured provider, so a signed-in owner can prove the
 * deployed site really reaches the AI (and see which provider and model answered). Costs one request.
 */
export const POST = api(async ({ db, advocateId }) => {
  await assertAiQuota(db, advocateId);
  const started = Date.now();
  const run = await runText({ kind: 'chat', system: 'You are a connectivity check. Reply with exactly: OK', messages: [{ role: 'user', content: 'Reply with exactly: OK' }], maxTokens: 300 });
  await recordUsage(db, advocateId, 'ai_test', run.model, run.inputTokens, run.outputTokens, run.requests);
  const { provider } = aiConfig();
  return {
    ok: true,
    provider,
    model: run.model,
    configuredModel: activeModel(),
    latencyMs: Date.now() - started,
    reply: run.text.trim().slice(0, 80),
    // A mock answer is not a real AI answer; say so plainly.
    real: provider !== 'mock',
  };
});
