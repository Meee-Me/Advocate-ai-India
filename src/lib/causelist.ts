/** Pure helpers for the cause-list import: matching a printed case number to the advocate's own cases. */

export interface CaseRef { id: string; title: string; caseNumber: string | null; cnrNumber: string | null }
export interface Match { caseId: string | null; caseTitle: string | null; confidence: 'exact' | 'check' | 'none' }

const squash = (s: string) => s.toUpperCase().replace(/[^A-Z0-9/]/g, '');

/** "WP(C) No. 1234 / 2024" and "W.P.(C).1234/2024" both become "WPC1234/2024". */
export const normaliseCaseNumber = (s: string) => squash(s.replace(/\bN[O0]\b\.?/gi, ' '));

/** The number/year pair of a case number ("1234/2024"), ignoring the case type and leading zeros. */
const numberYear = (s: string) => {
  const m = /(\d{1,6})\s*\/\s*(\d{4})/.exec(s);
  return m ? `${Number(m[1])}/${m[2]}` : null;
};

/**
 * exact: same CNR, or same case number after tidying. check: only the number and year agree, and exactly one case has them
 * (the case type was written differently), so the advocate must confirm it. none: not one of the advocate's cases.
 */
export function matchCase(row: { caseNumber: string; cnr?: string }, cases: CaseRef[]): Match {
  const cnr = squash(row.cnr ?? '');
  if (cnr.length >= 16) {
    const byCnr = cases.find((c) => c.cnrNumber && squash(c.cnrNumber) === cnr);
    if (byCnr) return { caseId: byCnr.id, caseTitle: byCnr.title, confidence: 'exact' };
  }
  const want = normaliseCaseNumber(row.caseNumber);
  if (want) {
    const same = cases.filter((c) => c.caseNumber && normaliseCaseNumber(c.caseNumber) === want);
    if (same.length === 1) return { caseId: same[0].id, caseTitle: same[0].title, confidence: 'exact' };
  }
  const ny = numberYear(row.caseNumber);
  if (ny) {
    const close = cases.filter((c) => c.caseNumber && numberYear(c.caseNumber) === ny);
    if (close.length === 1) return { caseId: close[0].id, caseTitle: close[0].title, confidence: 'check' };
  }
  return { caseId: null, caseTitle: null, confidence: 'none' };
}

/** Cause lists carry a date but no time: 10:30 India time unless the advocate says otherwise. */
export const istInstant = (date: string, time = '10:30') => new Date(`${date}T${time}:00+05:30`);

/** The start and end of a calendar day in India, as instants. */
export function istDay(date: string) {
  const from = istInstant(date, '00:00');
  return { from, to: new Date(from.getTime() + 24 * 3600 * 1000) };
}

/** Sort key for a printed item number: "12" < "12A" < "13", and rows without one come last. */
export function itemOrder(item: string | null | undefined) {
  const m = /^(\d+)\s*([A-Za-z]*)/.exec((item ?? '').trim());
  return m ? Number(m[1]) * 100 + (m[2] ? m[2].toUpperCase().charCodeAt(0) - 64 : 0) : Number.MAX_SAFE_INTEGER;
}
