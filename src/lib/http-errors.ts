// Kept separate so auth code can throw HTTP errors without importing http.ts
// (which imports the auth guard).
export class HttpError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
    this.name = 'HttpError';
  }
}
