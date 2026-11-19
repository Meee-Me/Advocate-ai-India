import { timingSafeEqual } from 'node:crypto';
import { open, json } from '@/lib/http';
import { cronSecret } from '@/lib/config';
import { getDb } from '@/lib/db';
import { runReminders } from '@/lib/db/repos/practice';

// Vercel Cron calls this with "Authorization: Bearer $CRON_SECRET".
export const GET = open(async (req) => {
  const secret = cronSecret();
  if (secret.length < 16) return json({ error: 'CRON_SECRET is not set (16+ characters).' }, 503);
  const given = Buffer.from((req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, ''));
  const want = Buffer.from(secret);
  if (given.length !== want.length || !timingSafeEqual(given, want)) return json({ error: 'Unauthorized' }, 401);
  const lookahead = Number(process.env.REMINDER_CRON_INTERVAL_MINUTES) || 1440;
  return runReminders(await getDb(), new Date(), lookahead);
});
