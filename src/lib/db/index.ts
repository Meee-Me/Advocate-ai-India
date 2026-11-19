import fs from 'node:fs';
import path from 'node:path';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { ConfigError, databaseConfig } from '@/lib/config';
import * as schema from './schema';

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

const g = globalThis as unknown as { __advocateDb?: Promise<Db> };

/** Applies supabase/migrations/*.sql to an embedded database (development and tests only). */
export async function applyMigrations(exec: (sql: string) => Promise<unknown>) {
  const dir = path.join(process.cwd(), 'supabase', 'migrations');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  await exec(`create table if not exists _migrations (name text primary key)`);
  for (const file of files) {
    await exec(`begin`);
    try {
      // Claim the migration first; skip if it was already applied.
      const claimed = (await (exec(`insert into _migrations (name) values ('${file}') on conflict do nothing returning name`) as Promise<{ rows: unknown[] }>)).rows;
      if (claimed.length) await exec(fs.readFileSync(path.join(dir, file), 'utf8'));
      await exec(`commit`);
    } catch (error) {
      await exec(`rollback`);
      throw error;
    }
  }
}

async function open(): Promise<Db> {
  const cfg = databaseConfig();
  if (cfg.driver === 'pglite') {
    const { PGlite } = await import('@electric-sql/pglite');
    const { drizzle } = await import('drizzle-orm/pglite');
    const dir = cfg.pgliteDir;
    if (dir !== 'memory://') fs.mkdirSync(dir, { recursive: true });
    const client = new PGlite(dir === 'memory://' ? undefined : dir);
    await client.waitReady;
    await applyMigrations((q) => client.query(q).catch((e: unknown) => {
      // PGlite's query() takes one statement; migrations hold many.
      if (e instanceof Error && /cannot insert multiple commands/i.test(e.message)) return client.exec(q);
      throw e;
    }));
    return drizzle(client, { schema }) as unknown as Db;
  }
  if (!cfg.url) {
    throw new ConfigError('DATABASE_URL is not set (Supabase -> Project Settings -> Database -> Transaction pooler).');
  }
  const { default: postgres } = await import('postgres');
  const { drizzle } = await import('drizzle-orm/postgres-js');
  // prepare:false is required by Supabase's transaction pooler (port 6543).
  const client = postgres(cfg.url, { prepare: false, max: 5, idle_timeout: 20, connect_timeout: 15 });
  return drizzle(client, { schema }) as unknown as Db;
}

export function getDb(): Promise<Db> {
  if (!g.__advocateDb) {
    g.__advocateDb = open().catch((error) => {
      g.__advocateDb = undefined; // allow a retry after a transient failure
      throw error;
    });
  }
  return g.__advocateDb;
}

/** For tests: use a specific database instance. */
export function setDb(db: Db | undefined) {
  g.__advocateDb = db ? Promise.resolve(db) : undefined;
}

export { schema };
