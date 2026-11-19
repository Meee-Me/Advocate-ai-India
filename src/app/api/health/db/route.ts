import { timingSafeEqual } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { open, json } from '@/lib/http';
import { cronSecret } from '@/lib/config';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

const EXPECTED = [
  'advocates', 'clients', 'cases', 'case_notes', 'hearings', 'notifications', 'documents',
  'analyses', 'drafts', 'draft_versions', 'conversations', 'messages', 'ai_usage',
];

/**
 * Database connection test. Protected: send "Authorization: Bearer $CRON_SECRET".
 * Runs SELECT 1 and a read-only catalog lookup for this app's own tables. It never returns the connection
 * string, host, user or driver error text (those can contain credentials); failures give only a short code.
 */
export const GET = open(async (req) => {
  const secret = cronSecret();
  if (secret.length < 16) return json({ error: 'CRON_SECRET is not set (16+ characters).' }, 503);
  const given = Buffer.from((req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, ''));
  const want = Buffer.from(secret);
  if (given.length !== want.length || !timingSafeEqual(given, want)) return json({ error: 'Unauthorized' }, 401);

  const started = Date.now();
  try {
    const db = await getDb();
    await db.execute(sql`select 1 as ok`);
    const latencyMs = Date.now() - started;
    const res = (await db.execute(
      sql`select table_name from information_schema.tables where table_schema = 'public' and table_name = any(${sql.raw(`array[${EXPECTED.map((t) => `'${t}'`).join(',')}]`)})`,
    )) as unknown as { rows?: { table_name: string }[] } | { table_name: string }[];
    const rows = Array.isArray(res) ? res : (res.rows ?? []);
    const present = new Set(rows.map((r) => r.table_name));
    const missing = EXPECTED.filter((t) => !present.has(t));
    return json({ ok: true, select1: true, latencyMs, tables: { expected: EXPECTED.length, present: present.size, missing } });
  } catch (error) {
    const code = (error as { code?: unknown })?.code;
    return json({ ok: false, select1: false, error: 'database_unreachable', code: typeof code === 'string' ? code.slice(0, 20) : undefined }, 503);
  }
});
