import type { ZodType } from 'zod';

export type Effort = 'low' | 'medium' | 'high';

export interface ChatMessage { role: 'user' | 'assistant'; content: string }

export interface RunInput {
  /** Used for usage accounting and (in mock mode) choosing a canned reply. */
  kind: string;
  system: string;
  messages: ChatMessage[];
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
  /** How many HTTP requests this answer cost (retries count): rate limits are per request. */
  requests: number;
}

export type StreamEvent = { type: 'delta'; text: string } | { type: 'done'; result: RunResult };

/** For answers that must be JSON of a known shape. */
export interface StructuredOptions {
  schema: ZodType<unknown>;
  jsonSchema: Record<string, unknown>;
}

/** One AI vendor. Add a vendor by implementing this and registering it in client.ts. */
export interface AiProvider {
  readonly name: string;
  stream(input: RunInput): AsyncGenerator<StreamEvent>;
  complete(input: RunInput, structured?: StructuredOptions): Promise<RunResult>;
}
