interface IcsHearing {
  id: string;
  hearingAt: Date;
  caseTitle: string;
  caseNumber: string | null;
  purpose: string | null;
  court: string | null;
  courtroom: string | null;
  notes: string | null;
  remindBeforeMinutes: number;
}

const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

/** RFC 5545: lines over 75 octets are folded with CRLF + space. */
function fold(line: string): string {
  const bytes = Buffer.from(line);
  if (bytes.length <= 75) return line;
  const parts: string[] = [];
  let cur = '';
  for (const ch of line) {
    const limit = parts.length === 0 ? 75 : 74;
    if (Buffer.byteLength(cur + ch) > limit) { parts.push(cur); cur = ch; } else cur += ch;
  }
  parts.push(cur);
  return parts.join('\r\n ');
}

export function buildIcs(hearings: IcsHearing[], now = new Date()): string {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Advocate AI India//Hearings//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:Court hearings'];
  for (const h of hearings) {
    const where = [h.court, h.courtroom ? `Court ${h.courtroom}` : null].filter(Boolean).join(', ');
    lines.push(
      'BEGIN:VEVENT',
      `UID:hearing-${h.id}@advocate-ai-india`,
      `DTSTAMP:${stamp(now)}`,
      `DTSTART:${stamp(h.hearingAt)}`,
      'DURATION:PT1H',
      `SUMMARY:${esc(`Hearing: ${h.caseTitle}${h.caseNumber ? ` (${h.caseNumber})` : ''}`)}`,
    );
    if (where) lines.push(`LOCATION:${esc(where)}`);
    const desc = [h.purpose, h.notes].filter(Boolean).join('\n');
    if (desc) lines.push(`DESCRIPTION:${esc(desc)}`);
    lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(`Hearing: ${h.caseTitle}`)}`, `TRIGGER:-PT${h.remindBeforeMinutes}M`, 'END:VALARM', 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
