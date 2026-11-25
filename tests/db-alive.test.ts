import { describe, expect, it } from 'vitest';
import { isAlive } from '@/lib/db';

describe('database connection check', () => {
  it('says alive when select 1 answers', async () => {
    expect(await isAlive((async () => [{ '?column?': 1 }]) as never, 200)).toBe(true);
  });
  it('says dead when the query never answers (a dead socket), within the timeout', async () => {
    const started = Date.now();
    expect(await isAlive((() => new Promise(() => undefined)) as never, 150)).toBe(false);
    expect(Date.now() - started).toBeLessThan(1500);
  });
  it('says dead when the query fails', async () => {
    expect(await isAlive((async () => { throw new Error('connection closed'); }) as never, 200)).toBe(false);
  });
});
