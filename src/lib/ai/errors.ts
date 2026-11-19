export class AiError extends Error {
  constructor(message: string, public status = 502, public code = 'ai_error', public retryAfterSeconds?: number) {
    super(message);
    this.name = 'AiError';
  }
}
