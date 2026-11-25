import fs from 'node:fs';
import path from 'node:path';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { ConfigError, databaseConfig } from '@/lib/config';
import * as schema from './schema';

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

type PgClient = { (strings: TemplateStringsArray): PromiseLike<unknown>; end(o?: { timeout?: number }): Promise<void> };
const g = globalThis as unknown as { __advocateDb?: Promise<Db>; __advocatePg?: { client: PgClient; lastUsed: number } };

/**
 * On Vercel the process is frozen between requests, so a pooled connection can be closed by the pooler while the site still
 * holds it. A query sent on that dead socket then waits for minutes. After a few idle seconds a cheap "select 1" checks the
 * connection first; if it does not answer in time, it is thrown away and a new one is opened.
 */
const PING_AFTER_MS = 5_000;
const PING_TIMEOUT_MS = 3_000;
export async function isAlive(client: (s: TemplateStringsArray) => PromiseLike<unknown>, timeoutMs = PING_TIMEOUT_MS): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.resolve(client`select 1`),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('ping timeout')), timeoutMs); }),
    ]);
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

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
  // max_pipeline: 1 sends one query at a time per connection. Pages that run several queries at once (the dashboard, a case's
  // details) hung when the driver pipelined them over Supabase's transaction pooler; extra queries now use another connection.
  const client = postgres(cfg.url, { prepare: false, max: 5, max_pipeline: 1, idle_timeout: 20, connect_timeout: 10 });
  g.__advocatePg = { client: client as unknown as PgClient, lastUsed: Date.now() };
  return drizzle(client, { schema }) as unknown as Db;
}

export async function getDb(): Promise<Db> {
  const pg = g.__advocatePg;
  if (pg && g.__advocateDb && Date.now() - pg.lastUsed > PING_AFTER_MS && !(await isAlive(pg.client as never))) {
    console.error('Database connection did not answer; opening a new one');
    pg.client.end({ timeout: 1 }).catch(() => undefined); // not awaited: a dead socket may never close cleanly
    g.__advocateDb = undefined;
    g.__advocatePg = undefined;
  }
  if (g.__advocatePg) g.__advocatePg.lastUsed = Date.now();
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
