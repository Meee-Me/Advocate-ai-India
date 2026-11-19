import fs from 'node:fs';
import path from 'node:path';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { ConfigError, databaseConfig } from '@/lib/config';
import * as schema from './schema';

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

const g = globalThis as unknown as { __advocateDb?: Promise<Db> };

interface MigrationClient {
  query(sql: string): Promise<{ rows: unknown[] }>;
  exec(sql: string): Promise<unknown>;
}

/** Applies supabase/migrations/*.sql, once each, to an embedded database (development and tests only). */
export async function applyMigrations(c: MigrationClient) {
  const dir = path.join(process.cwd(), 'supabase', 'migrations');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  await c.exec(`create table if not exists _migrations (name text primary key)`);
  for (const file of files) {
    if ((await c.query(`select 1 from _migrations where name = '${file}'`)).rows.length) continue;
    try {
      // exec() runs many statements; the whole file and its bookkeeping row commit together.
      await c.exec(`begin;\n${fs.readFileSync(path.join(dir, file), 'utf8')}\ninsert into _migrations (name) values ('${file}');\ncommit;`);
    } catch (error) {
      await c.exec('rollback').catch(() => undefined);
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
    await applyMigrations(client);
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
