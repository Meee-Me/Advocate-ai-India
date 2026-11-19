'use client';
import useSWR, { mutate as globalMutate, type SWRConfiguration } from 'swr';

export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string) {
    super(message);
  }
}

export async function api<T = unknown>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: opts.method ?? (opts.body === undefined ? 'GET' : 'POST'),
      headers: opts.body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      credentials: 'same-origin',
    });
  } catch {
    throw new ApiError('Could not reach the server. Check your connection and try again.', 0);
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && typeof window !== 'undefined' && !path.startsWith('/api/auth/')) {
    window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
  }
  if (!res.ok) throw new ApiError(data?.error ?? 'Something went wrong.', res.status, data?.code);
  return data as T;
}

export function useApi<T>(key: string | null, config?: SWRConfiguration<T>) {
  return useSWR<T>(key, (k: string) => api<T>(k), { revalidateOnFocus: false, dedupingInterval: 300, ...config });
}

export const errorText = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong.');

export const fmtDateTime = (d: string | Date) =>
  new Date(d).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
export const fmtDate = (d: string | Date) => new Date(d).toLocaleDateString('en-IN', { dateStyle: 'medium' });

/** <input type="datetime-local"> value for a Date, in the browser's time zone. */
export function toLocalInput(d: Date | string) {
  const x = new Date(d);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}T${p(x.getHours())}:${p(x.getMinutes())}`;
}

export interface SseEvent { event: string; data: any } // eslint-disable-line @typescript-eslint/no-explicit-any

/** POSTs and reads a server-sent-event stream, calling `onEvent` for each event. */
export async function postStream(path: string, body: unknown, onEvent: (e: SseEvent) => void): Promise<void> {
  const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), credentials: 'same-origin' });
  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) window.location.href = '/login';
    throw new ApiError(data?.error ?? 'Something went wrong.', res.status, data?.code);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const event = /^event: (.*)$/m.exec(block)?.[1];
      const data = /^data: (.*)$/m.exec(block)?.[1];
      if (event && data) onEvent({ event, data: JSON.parse(data) });
    }
  }
}

/** Refetch every cached list whose address starts with `prefix` (e.g. after creating a client). */
export const refresh = (prefix: string) => globalMutate((k) => typeof k === 'string' && k.startsWith(prefix));
