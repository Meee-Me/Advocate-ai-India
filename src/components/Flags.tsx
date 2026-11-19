'use client';
import { Badge } from './ui';

export interface Flag { kind: string; text: string; note: string }
const label: Record<string, string> = { citation: 'Citation', case_name: 'Case name', act: 'Act' };

/** The authorities the system could not trace to the advocate's own material. */
export function Flags({ flags }: { flags: Flag[] | undefined }) {
  if (!flags?.length) return null;
  return (
    <div className="rounded-lg border border-warn/30 bg-warn-soft p-3 text-sm" role="note">
      <p className="font-semibold text-warn">⚠️ {flags.length} authorit{flags.length === 1 ? 'y' : 'ies'} to verify before you rely on {flags.length === 1 ? 'it' : 'them'}</p>
      <p className="mt-0.5 text-xs text-warn/90">These were not found in your documents or messages. They come from the AI&apos;s memory and may be wrong or invented.</p>
      <ul className="mt-2 space-y-1.5">
        {flags.map((f, i) => (
          <li key={i} className="flex flex-wrap items-start gap-2">
            <Badge tone="warn">{label[f.kind] ?? f.kind}</Badge>
            <span className="font-medium">{f.text}</span>{f.kind === 'citation' && f.text === 'A citation was removed' && <span className="text-xs text-warn/90">(not shown: it was not in your documents)</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

export const Verified = ({ v }: { v: boolean | null | undefined }) =>
  v === true ? <Badge tone="ok">found in document</Badge> : v === false ? <Badge tone="danger">NOT found in document</Badge> : <Badge>not checkable (scanned)</Badge>;
