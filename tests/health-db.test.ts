import { beforeAll, describe, expect, it } from 'vitest';
import * as dbHealth from '@/app/api/health/db/route';
import { call, setup } from './harness';

const AUTH = { headers: { authorization: 'Bearer cron-secret-0123456789' } };

describe('GET /api/health/db', () => {
  beforeAll(async () => {
    await setup();
  });

  it('refuses callers without the secret', async () => {
    expect((await call(dbHealth.GET, 'GET', '/api/health/db')).status).toBe(401);
    expect((await call(dbHealth.GET, 'GET', '/api/health/db', { headers: { authorization: 'Bearer wrong-secret-000000000' } })).status).toBe(401);
  });

  it('runs SELECT 1 and reports tables, without leaking configuration', async () => {
    const res = await call(dbHealth.GET, 'GET', '/api/health/db', AUTH);
    expect(res.status).toBe(200);
    expect(res.data).toMatchObject({ ok: true, select1: true, tables: { expected: 13, present: 13, missing: [] } });
    const text = JSON.stringify(res.data);
    expect(text).not.toMatch(/postgres(ql)?:\/\//i);
    expect(text).not.toContain('cron-secret');
  });
});
