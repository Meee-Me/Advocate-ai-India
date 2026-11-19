import type { Db } from '@/lib/db';
import { getCaseDetail } from '@/lib/db/repos/practice';

const cut = (s: string | null | undefined, n: number) => (s && s.length > n ? s.slice(0, n) + '…' : s ?? '');

/** A compact description of a case, given to the AI as facts the advocate supplied. */
export async function matterContext(db: Db, advocateId: string, caseId: string | null | undefined): Promise<string | undefined> {
  if (!caseId) return undefined;
  const d = await getCaseDetail(db, advocateId, caseId);
  const c = d.case;
  const lines = [
    `Case: ${c.title}`,
    c.caseNumber && `Case number: ${c.caseNumber}`,
    c.court && `Court: ${c.court}`,
    c.caseType && `Type: ${c.caseType}`,
    `Status: ${c.status}${c.stage ? `, stage: ${c.stage}` : ''}`,
    c.ourSide && `We appear for: ${c.ourSide}`,
    c.petitioner && `Petitioner/plaintiff: ${c.petitioner}`,
    c.respondent && `Respondent/defendant: ${c.respondent}`,
    c.judge && `Judge: ${c.judge}`,
    c.description && `Description: ${cut(c.description, 2500)}`,
    ...d.notes.slice(0, 10).map((n) => `Note (${n.createdAt.toISOString().slice(0, 10)}): ${cut(n.body, 500)}`),
  ].filter(Boolean);
  return cut(lines.join('\n'), 6000);
}
