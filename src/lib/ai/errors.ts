export class AiError extends Error {
  constructor(message: string, public status = 502, public code = 'ai_error') {
    super(message);
    this.name = 'AiError';
  }
}
