import { describe, expect, it } from 'vitest';
import { guard, guardDeep, StreamGuard, findAuthorities, quoteInSource } from '@/lib/legal/citation-guard';

const kinds = (t: string, src: string[] = []) => findAuthorities(t, src).map((h) => `${h.flag.kind}:${h.flag.text}`);

describe('citation guard: flags what the advocate did not supply', () => {
  it('flags common Indian reporter citations', () => {
    const t = 'See AIR 1973 SC 1461, (2017) 10 SCC 1, 2019 SCC OnLine SC 1234, [1973] Supp. 1 SCR 1, 2010 Cri LJ 1234, 2023 INSC 123, 2024:DHC:1234, MANU/SC/0001/2017, 1994 Supp (3) SCC 1 and Civil Appeal No. 1234 of 2019.';
    const found = kinds(t).map((s) => s.split(':').slice(1).join(':'));
    for (const c of ['AIR 1973 SC 1461', '(2017) 10 SCC 1', '2019 SCC OnLine SC 1234', '[1973] Supp. 1 SCR 1', '2010 Cri LJ 1234', '2023 INSC 123', '2024:DHC:1234', 'MANU/SC/0001/2017', '1994 Supp (3) SCC 1', 'Civil Appeal No. 1234 of 2019']) {
      expect(found, c).toContain(c);
    }
  });

  it('does not flag a citation the advocate supplied (any spacing/case)', () => {
    expect(kinds('Relied on AIR 1973 SC 1461.', ['The petitioner cites  air 1973  SC 1461 in para 4.'])).toEqual([]);
    expect(kinds('Relied on AIR 1973 SC 1461.', ['something else'])).toHaveLength(1);
  });

  it('flags "X v. Y" case names, trims lead-in words, and accepts supplied ones', () => {
    expect(kinds('In Kesavananda Bharati v. State of Kerala the Court held')).toEqual(['case_name:Kesavananda Bharati v. State of Kerala']);
    expect(kinds('As held in State of Maharashtra vs. Mohd Yakub, the...')[0]).toContain('State of Maharashtra v. Mohd Yakub');
    expect(kinds('See Kesavananda Bharati v. State of Kerala.', ['judgment: Kesavananda Bharati v. State of Kerala (1973)'])).toEqual([]);
  });

  it('flags Act names not in the built-in list, never known ones', () => {
    expect(kinds('under the Indian Penal Code, 1860 and the Information Technology Act, 2000')).toEqual([]);
    expect(kinds('under the Bharatiya Nyaya Sanhita, 2023')).toEqual([]);
    expect(kinds('Under the Indian Contract Act, 1872 you must pay')).toEqual([]); // sentence-start words are not part of the name
    expect(kinds('under the Fictional Lawyers Protection Act, 2011')).toEqual(['act:Fictional Lawyers Protection Act, 2011']);
    expect(kinds('under the Fictional Lawyers Protection Act, 2011', ['Fictional Lawyers Protection Act, 2011'])).toEqual([]);
    expect(kinds('under the Indian Penal Code, 1999')).toHaveLength(1); // right name, wrong year
  });

  it('tags inline, once per flag in the list, and leaves clean text alone', () => {
    const r = guard('Held in AIR 1973 SC 1461. Again AIR 1973 SC 1461.', [], { inline: true, citations: 'tag' });
    expect(r.text).toBe('Held in AIR 1973 SC 1461 ⚠️[unverified]. Again AIR 1973 SC 1461 ⚠️[unverified].');
    expect(r.flags).toHaveLength(1);
    // The Act is a known one, so only the section number is listed (it came from memory, not from the advocate's material).
    expect(guard('Section 138 of the Negotiable Instruments Act, 1881 deals with dishonour of cheques.', []).flags.map((f) => f.kind)).toEqual(['provision']);
    expect(guard('AIR 1973 SC 1461', [], { inline: false, citations: 'tag' }).text).toBe('AIR 1973 SC 1461');
  });

  it('does not treat ordinary sentences as case names', () => {
    expect(kinds('The petitioner is aggrieved. The respondent denies the allegation.')).toEqual([]);
    expect(kinds('Section 420 versus Section 406 are different offences.').filter((k) => !k.startsWith('provision:'))).toEqual([]);
  });

  it('checks quotes against the source text', () => {
    const src = 'The Court observed that "justice delayed is justice denied" in this matter.';
    expect(quoteInSource('Justice delayed is justice denied', src)).toBe(true);
    expect(quoteInSource('justice is blind', src)).toBe(false);
    expect(quoteInSource('a', src)).toBe(false);
  });
});


describe('strict mode: unverified citations are removed, not just marked', () => {
  const sources = ['The petitioner relies on (2017) 10 SCC 1.'];
  it('removes citations that are not in the advocate\'s material and keeps the ones that are', () => {
    const r = guard('See AIR 1973 SC 1461 and (2017) 10 SCC 1 and 2019 SCC OnLine SC 1234.', sources);
    expect(r.text).toBe('See [citation withheld: not found in your documents] and (2017) 10 SCC 1 and [citation withheld: not found in your documents].');
    // The removed citations are never named again, not even in the flag list.
    expect(r.flags.map((f) => f.text)).toEqual(['A citation was removed', 'A citation was removed']);
    expect(JSON.stringify(r.flags)).not.toMatch(/AIR 1973|OnLine/);
    expect(r.flags[0].note).toMatch(/Removed/);
  });
  it('uses a custom placeholder (drafts) and still tags case names and Acts', () => {
    const r = guard('Held in Foo v. Bar, AIR 1950 SC 27.', [], { inline: true, citations: 'redact', placeholder: '[CITATION TO BE VERIFIED]' });
    expect(r.text).toContain('[CITATION TO BE VERIFIED]');
    expect(r.text).not.toContain('AIR 1950');
    expect(r.text).toContain('Foo v. Bar ⚠️[unverified]');
  });
  it('redacts without tagging when inline is off (documents for filing)', () => {
    expect(guard('x AIR 1950 SC 27 y', [], { inline: false }).text).toBe('x [citation withheld: not found in your documents] y');
  });
  it('redacts inside every string of a structured result', () => {
    const r = guardDeep({ a: 'AIR 1950 SC 27', b: ['ok', 'also (2001) 1 SCC 1'], c: 5 }, []);
    expect(JSON.stringify(r.value)).not.toMatch(/AIR 1950|2001\) 1 SCC/);
    expect(r.flags).toHaveLength(2);
    expect(JSON.stringify(r.flags)).not.toMatch(/AIR 1950|2001/);
    expect(r.value.c).toBe(5);
  });
  it('never lets a citation through while streaming, however the text is chunked', () => {
    const full = 'Intro line.\nHeld in AIR 1973 SC 1461 by the Court.\nCited (2017) 10 SCC 1 too.\nLast words without newline AIR 1950 SC 27';
    for (const size of [1, 2, 3, 5, 7, 13, 50]) {
      const sg = new StreamGuard(sources, { inline: true });
      let out = '';
      for (let i = 0; i < full.length; i += size) out += sg.push(full.slice(i, i + size));
      out += sg.flush();
      expect(out, `chunk size ${size}`).not.toContain('AIR 1973');
      expect(out, `chunk size ${size}`).not.toContain('AIR 1950');
      expect(out, `chunk size ${size}`).toContain('(2017) 10 SCC 1');
      expect(out, `chunk size ${size}`).toContain('Intro line.');
    }
  });
});
