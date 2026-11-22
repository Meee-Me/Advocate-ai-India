// Kept separate so auth code can throw HTTP errors without importing http.ts
// (which imports the auth guard).
export class HttpError extends Error {
  /** Set-Cookie values to send with the error response (e.g. clearing a stale session). */
  cookies: string[] = [];

  constructor(public status: number, message: string, public code?: string) {
    super(message);
    this.name = 'HttpError';
  }

  withCookies(cookies: string[]): this {
    this.cookies = cookies;
    return this;
  }
}
