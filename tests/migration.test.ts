import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { schema } from '@/lib/db';
import { freshDb } from './helpers';

describe('database migration', () => {
  it('applies cleanly and matches the Drizzle schema (insert + read every table)', async () => {
    const { db, client } = await freshDb();
    const [adv] = await db.insert(schema.advocates).values({ deluxeAccountId: 'u1', displayName: 'A One' }).returning();
    expect(adv.languages).toEqual(['english']);
    const [cl] = await db.insert(schema.clients).values({ advocateId: adv.id, name: 'Client' }).returning();
    const [cs] = await db.insert(schema.cases).values({ advocateId: adv.id, clientId: cl.id, title: 'T v. S' }).returning();
    expect(cs.status).toBe('open');
    await db.insert(schema.caseNotes).values({ advocateId: adv.id, caseId: cs.id, body: 'n' });
    const [h] = await db.insert(schema.hearings).values({ advocateId: adv.id, caseId: cs.id, hearingAt: new Date(Date.now() + 864e5) }).returning();
    await db.insert(schema.notifications).values({ advocateId: adv.id, kind: 'k', title: 't', hearingId: h.id });
    const [doc] = await db.insert(schema.documents).values({ advocateId: adv.id, title: 'd', fileName: 'd.pdf', mimeType: 'application/pdf', storagePath: 'p' }).returning();
    await db.insert(schema.analyses).values({ advocateId: adv.id, documentId: doc.id, kind: 'summary', title: 's', result: { a: 1 } });
    const [dr] = await db.insert(schema.drafts).values({ advocateId: adv.id, title: 'x' }).returning();
    await db.insert(schema.draftVersions).values({ advocateId: adv.id, draftId: dr.id, content: 'c' });
    const [conv] = await db.insert(schema.conversations).values({ advocateId: adv.id }).returning();
    await db.insert(schema.messages).values({ advocateId: adv.id, conversationId: conv.id, role: 'user', content: 'hi' });
    await db.insert(schema.aiUsage).values({ advocateId: adv.id, kind: 'chat' });

    // Deleting the advocate cascades everything.
    await db.delete(schema.advocates).where(eq(schema.advocates.id, adv.id));
    for (const t of ['clients', 'cases', 'hearings', 'notifications', 'documents', 'analyses', 'drafts', 'draft_versions', 'conversations', 'messages', 'ai_usage']) {
      const r = await client.query<{ n: number }>(`select count(*)::int as n from ${t}`);
      expect(r.rows[0].n, t).toBe(0);
    }
  });

  it('enforces check constraints and the updated_at trigger', async () => {
    const { db, client } = await freshDb();
    const [adv] = await db.insert(schema.advocates).values({ deluxeAccountId: 'u2', displayName: 'B' }).returning();
    await expect(db.insert(schema.cases).values({ advocateId: adv.id, title: 't', status: 'bogus' })).rejects.toThrow();
    await expect(db.insert(schema.advocates).values({ deluxeAccountId: 'u2', displayName: 'dup' })).rejects.toThrow();
    const before = adv.updatedAt;
    await new Promise((r) => setTimeout(r, 15));
    const [after] = await db.update(schema.advocates).set({ city: 'Pune' }).where(eq(schema.advocates.id, adv.id)).returning();
    expect(after.updatedAt.getTime()).toBeGreaterThan(before.getTime());
    const rls = await client.query<{ relname: string }>(`select relname from pg_class where relkind='r' and relnamespace='public'::regnamespace and not relrowsecurity`);
    expect(rls.rows).toEqual([]); // RLS is on for every table
  });
});

describe('embedded development database', () => {
  it('bootstraps from the migrations and reopens an existing database without re-running them', async () => {
    const fs = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');
    const { getDb, setDb } = await import('@/lib/db');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'adv-pg-'));
    Object.assign(process.env, { DATABASE_DRIVER: 'pglite', PGLITE_DIR: dir });
    try {
      setDb(undefined);
      const db1 = await getDb();
      await db1.insert(schema.advocates).values({ deluxeAccountId: 'persist', displayName: 'P' });
      await (db1 as unknown as { $client: { close(): Promise<void> } }).$client.close();
      setDb(undefined);
      const db2 = await getDb(); // second open: migrations already applied
      expect((await db2.select().from(schema.advocates)).map((a) => a.deluxeAccountId)).toEqual(['persist']);
    } finally {
      delete process.env.DATABASE_DRIVER; delete process.env.PGLITE_DIR; setDb(undefined);
    }
  });
});

describe('failed migrations roll back', () => {
  it('leaves no partial schema and a usable connection', async () => {
    const fs = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');
    const { PGlite } = await import('@electric-sql/pglite');
    const { applyMigrations } = await import('@/lib/db');
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'adv-badmig-'));
    fs.mkdirSync(path.join(work, 'supabase', 'migrations'), { recursive: true });
    fs.writeFileSync(path.join(work, 'supabase', 'migrations', '0001_bad.sql'), 'create table half_made (x int);\nselect * from table_that_does_not_exist;');
    const client = new PGlite();
    const cwd = process.cwd();
    process.chdir(work);
    try {
      await expect(applyMigrations(client)).rejects.toThrow(/table_that_does_not_exist/);
    } finally { process.chdir(cwd); }
    expect((await client.query('select 1 as ok')).rows).toEqual([{ ok: 1 }]); // not left in an aborted transaction
    expect((await client.query(`select to_regclass('half_made') as t`)).rows).toEqual([{ t: null }]); // nothing half-applied
    expect((await client.query(`select count(*)::int as n from _migrations`)).rows).toEqual([{ n: 0 }]);
  });
});
