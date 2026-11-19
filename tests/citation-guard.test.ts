import { describe, expect, it } from 'vitest';
import { guard, findAuthorities, quoteInSource } from '@/lib/legal/citation-guard';

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
    const r = guard('Held in AIR 1973 SC 1461. Again AIR 1973 SC 1461.', []);
    expect(r.text).toBe('Held in AIR 1973 SC 1461 ⚠️[unverified]. Again AIR 1973 SC 1461 ⚠️[unverified].');
    expect(r.flags).toHaveLength(1);
    expect(guard('Section 138 of the Negotiable Instruments Act, 1881 deals with dishonour of cheques.', []).flags).toEqual([]);
    expect(guard('AIR 1973 SC 1461', [], false).text).toBe('AIR 1973 SC 1461');
  });

  it('does not treat ordinary sentences as case names', () => {
    expect(kinds('The petitioner is aggrieved. The respondent denies the allegation.')).toEqual([]);
    expect(kinds('Section 420 versus Section 406 are different offences.')).toEqual([]);
  });

  it('checks quotes against the source text', () => {
    const src = 'The Court observed that "justice delayed is justice denied" in this matter.';
    expect(quoteInSource('Justice delayed is justice denied', src)).toBe(true);
    expect(quoteInSource('justice is blind', src)).toBe(false);
    expect(quoteInSource('a', src)).toBe(false);
  });
});
