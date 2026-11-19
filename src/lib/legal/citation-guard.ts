import { isKnownAct } from './known-acts';

/**
 * Deterministic check on model output. A language model cannot verify that a case
 * exists, so this does not try to: it finds every citation, case name and Act name
 * in a piece of text and checks each against the material the advocate actually
 * supplied (their messages, uploaded documents, case notes). Anything that cannot be
 * traced to that material is flagged, and can be tagged inline, so an invented or
 * misremembered authority is never presented as if it were checked.
 */
export type FlagKind = 'citation' | 'case_name' | 'act';
export interface Flag { kind: FlagKind; text: string; note: string }

const NOTE = {
  citation: 'Citation not found in your documents or messages. Do not rely on it until you have checked it on an official or licensed law report (Supreme Court of India, eCourts, Indian Kanoon, SCC Online, Manupatra).',
  case_name: 'Case name not found in your documents or messages. It comes from the AI\'s memory and may be wrong or invented; confirm it exists and says what is claimed.',
  act: 'This Act is not in the built-in list of major central Acts. It may still be real (state Acts and many others are not in the list); confirm the name, year and sections on India Code (indiacode.nic.in).',
};

const CITATION_PATTERNS: RegExp[] = [
  /\bAIR\s+(?:19|20)\d{2}\s+[A-Z][A-Za-z]{1,9}\s+\d{1,5}\b/g, // AIR 1973 SC 1461
  /\(\d{4}\)\s+\d{1,3}\s+(?:S\.?C\.?C\.?|SCC)(?:\s*\((?:Cri|L&S|Civ|Cr|Tax|Supp)\))?\s+\d{1,4}\b/g, // (2017) 10 SCC 1
  /\b\d{4}\s+Supp\.?\s*\(\d+\)\s+SCC\s+\d+\b/g, // 1994 Supp (3) SCC 1
  /\b\d{4}\s+SCC\s+OnLine\s+[A-Za-z.]{2,12}\s+\d{1,7}\b/g, // 2019 SCC OnLine SC 1234
  /\[\d{4}\]\s+(?:Supp\.?\s*)?\(?\d*\)?\s*S\.?C\.?R\.?\s+\d{1,4}\b/g, // [1973] Supp. 1 SCR 1
  /\b\d{4}\s+Cri\.?\s*L\.?\s*J\.?\s+\d{1,5}\b/g, // 2010 Cri LJ 1234
  /\bILR\s+\(?\d{4}\)?\s+[A-Za-z]{2,10}\.?\s+\d{1,5}\b/g, // ILR 1985 Kar 12
  /\bMANU\/[A-Z]{2,4}\/\d{3,6}\/\d{4}\b/g, // Manupatra
  /\b\d{4}\s+INSC\s+\d{1,5}\b/g, // 2023 INSC 123 (neutral)
  /\b\d{4}\s*:\s*[A-Z]{2,6}\s*:\s*\d{1,6}\b/g, // 2024:DHC:1234 (neutral)
  /\b(?:Civil Appeal|Criminal Appeal|Writ Petition|Special Leave Petition|Transfer Petition|Review Petition|Contempt Petition)\s*(?:\([A-Za-z.]+\)\s*)?(?:Diary\s*)?No\.?\s*\d{1,6}(?:\s*of|\s*\/)\s*\d{4}\b/gi, // Civil Appeal No. 1234 of 2019
];

// A party name: capitalised words, optionally joined by of/and/for/... ("Union of India").
// "the" is deliberately not a joiner, so "...State of Kerala the Court held" stops at Kerala.
const PARTY = String.raw`[A-Z][\w.&'’\-]*(?:\s+(?:(?:of|and|&|for|on|in|to)\s+)?[A-Z][\w.&'’\-]*){0,6}`;
// "X v. Y" / "X vs Y": both sides start with a capital letter.
const CASE_NAME = new RegExp(String.raw`\b(${PARTY})\s+(?:v\.|vs\.?|versus)\s+(${PARTY})`, 'g');
const LEAD_WORDS = new Set(['in', 'see', 'also', 'the', 'as', 'per', 'following', 'cf', 'vide', 'under', 'case', 'of', 'and', 'but', 'held', 'whereas', 'where', 'when', 'this', 'that', 'a', 'an', 'by', 'from', 'with', 'our', 'your', 'then', 'thus', 'however', 'courts', 'court']);

const ACT = /\b((?:Code of (?:Criminal|Civil) Procedure)|(?:(?:The\s+)?[A-Z][A-Za-z&'’()\-,]*(?:\s+(?:of|and|the|for|on|in|to|\(?[A-Z][A-Za-z&'’()\-,]*\)?)){0,12}?\s+(?:Act|Sanhita|Adhiniyam|Code))),?\s+(?:of\s+)?((?:18|19|20)\d{2})\b/g;

const normalise = (s: string) => s.toLowerCase().replace(/[‘’]/g, "'").replace(/[^a-z0-9]+/g, ' ').trim();

function trimLeadWords(name: string): string {
  const words = name.split(/\s+/);
  while (words.length > 2 && LEAD_WORDS.has(words[0].toLowerCase().replace(/[^a-z]/g, ''))) words.shift();
  return words.join(' ');
}

interface Hit { start: number; end: number; flag: Flag }

export function findAuthorities(output: string, sources: string[]): Hit[] {
  const corpus = normalise(sources.join('\n'));
  const inSources = (s: string) => corpus.length > 0 && corpus.includes(normalise(s));
  const hits: Hit[] = [];
  const taken = (a: number, b: number) => hits.some((h) => a < h.end && b > h.start);

  for (const re of CITATION_PATTERNS) {
    for (const m of output.matchAll(re)) {
      const start = m.index!;
      if (taken(start, start + m[0].length) || inSources(m[0])) continue;
      hits.push({ start, end: start + m[0].length, flag: { kind: 'citation', text: m[0], note: NOTE.citation } });
    }
  }
  for (const m of output.matchAll(ACT)) {
    const year = m[2];
    // A sentence may start "Under the Indian Contract Act, 1872": try every trailing phrase of the name.
    const words = m[1].trim().split(/\s+/);
    const phrases = words.map((_, i) => words.slice(i).join(' '));
    if (phrases.some((p) => isKnownAct(p, year) || inSources(`${p} ${year}`) || inSources(p))) continue;
    let k = 0;
    while (k < words.length - 2 && LEAD_WORDS.has(words[k].toLowerCase().replace(/[^a-z]/g, ''))) k++;
    const shown = `${words.slice(k).join(' ')}, ${year}`;
    const start = m.index!;
    if (taken(start, start + m[0].length)) continue;
    hits.push({ start, end: start + m[0].length, flag: { kind: 'act', text: shown, note: NOTE.act } });
  }
  for (const m of output.matchAll(CASE_NAME)) {
    const left = trimLeadWords(m[1]);
    const text = `${left} v. ${m[2]}`;
    const start = m.index! + Math.max(0, m[0].indexOf(left));
    const end = m.index! + m[0].length;
    if (taken(start, end)) continue;
    if (inSources(text) || (inSources(left) && inSources(m[2]))) continue;
    hits.push({ start, end, flag: { kind: 'case_name', text, note: NOTE.case_name } });
  }
  return hits.sort((a, b) => a.start - b.start);
}

export interface GuardResult { text: string; flags: Flag[] }

export interface GuardOptions {
  /** Mark flagged spans in the text (chat, research). */
  inline?: boolean;
  /** "redact" (default, strict): reporter citations that cannot be traced to the advocate's material are REMOVED. "tag": only marked. */
  citations?: 'tag' | 'redact';
  /** What replaces a removed citation. */
  placeholder?: string;
}

export const REMOVED_NOTE = 'Removed from the text because it was not found in your documents or messages. If you need it, find the real citation on an official or licensed law report.';
/** What a removed citation is called in flag lists: its text is never shown again. */
export const REMOVED_TEXT = 'A citation was removed';
export const DEFAULT_PLACEHOLDER = '[citation withheld: not found in your documents]';

/**
 * @param output  text produced by the model
 * @param sources everything the advocate supplied (the only things that can verify an authority)
 * @param opts    `true`/`false` = inline on/off with default (strict) redaction, or full options
 */
export function guard(output: string, sources: string[], opts: boolean | GuardOptions = true): GuardResult {
  const o: GuardOptions = typeof opts === 'boolean' ? { inline: opts } : opts;
  const redact = (o.citations ?? 'redact') === 'redact';
  const hits = findAuthorities(output, sources);
  const seen = new Set<string>();
  const flags: Flag[] = [];
  for (const h of hits) {
    const key = `${h.flag.kind}:${normalise(h.flag.text)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    // A removed citation is reported without its text: the point is that it is gone, not that it is shown again.
    flags.push(redact && h.flag.kind === 'citation' ? { kind: 'citation', text: REMOVED_TEXT, note: REMOVED_NOTE } : h.flag);
  }
  // Removal always applies in redact mode (a draft for filing must not carry an invented citation either);
  // tagging applies only when `inline` is set.
  if (!hits.length || (!o.inline && !redact)) return { text: output, flags };
  let text = '';
  let last = 0;
  for (const h of hits) {
    text += output.slice(last, h.start);
    if (redact && h.flag.kind === 'citation') text += o.placeholder ?? DEFAULT_PLACEHOLDER;
    else text += output.slice(h.start, h.end) + (o.inline ? ' ⚠️[unverified]' : '');
    last = h.end;
  }
  return { text: text + output.slice(last), flags };
}

/**
 * Applies the guard to text as it streams in. Only complete lines are released: a citation never contains a
 * line break, so none can be cut in half, and each released line has already been checked. The cost is that
 * text appears a line at a time.
 */
export class StreamGuard {
  private buffer = '';
  constructor(private sources: string[], private opts: GuardOptions = { inline: true }) {}
  push(delta: string): string {
    this.buffer += delta;
    const cut = this.buffer.lastIndexOf('\n');
    if (cut < 0) return '';
    const chunk = this.buffer.slice(0, cut + 1);
    this.buffer = this.buffer.slice(cut + 1);
    return guard(chunk, this.sources, this.opts).text;
  }
  flush(): string {
    const rest = this.buffer;
    this.buffer = '';
    return rest ? guard(rest, this.sources, this.opts).text : '';
  }
}

/** Guards every string inside a JSON-like value (structured research results). */
export function guardDeep<T>(value: T, sources: string[], opts: GuardOptions = { inline: false }): { value: T; flags: Flag[] } {
  const flags: Flag[] = [];
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') {
      const r = guard(v, sources, opts);
      flags.push(...r.flags);
      return r.text;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  const out = walk(value) as T;
  const seen = new Set<string>();
  // Removals are all kept (their text is generic, so de-duplicating would hide how many there were).
  return { value: out, flags: flags.filter((f) => { if (f.note === REMOVED_NOTE) return true; const k = `${f.kind}:${normalise(f.text)}`; return seen.has(k) ? false : (seen.add(k), true); }) };
}

/** True if `quote` appears verbatim (ignoring spacing, case and punctuation) in `source`. */
export function quoteInSource(quote: string, source: string): boolean {
  const q = normalise(quote);
  return q.length >= 8 && normalise(source).includes(q);
}
