import { describe, expect, it } from 'vitest';
import { findAuthorities, guard } from '@/lib/legal/citation-guard';

const provisions = (text: string, sources: string[] = []) => findAuthorities(text, sources).filter((h) => h.flag.kind === 'provision').map((h) => h.flag.text);

describe('statute section numbers from the model’s memory', () => {
  it('flags section and article numbers, with the Act when it follows', () => {
    expect(provisions('The notice is under Section 138 of the Negotiable Instruments Act, 1881.')).toEqual(['Section 138, Negotiable Instruments Act, 1881']);
    expect(provisions('Article 21 guarantees life and liberty.')).toEqual(['Article 21']);
    expect(provisions('Under S. 482(1) CrPC and Sections 138 and 141 the court may act.')).toEqual(['S. 482(1)', 'Sections 138 and 141']);
    expect(provisions('See Order VII Rule 11 of the Code of Civil Procedure.')).toEqual(['Order VII Rule 11, Code of Civil Procedure']);
  });
  it('does not flag a provision the advocate supplied, however it is written', () => {
    expect(provisions('Section 138 applies.', ['The complaint is under Sec. 138 of the NI Act.'])).toEqual([]);
    expect(provisions('Article 226 applies.', ['Art. 226 of the Constitution'])).toEqual([]);
    expect(provisions('Sections 138 and 141 apply.', ['Section 138 and 141'])).toEqual([]);
  });
  it('flags a number that is only partly supplied, and a different article with the same number as a section', () => {
    expect(provisions('Sections 138 and 142 apply.', ['Section 138'])).toEqual(['Sections 138 and 142']);
    expect(provisions('Article 138 applies.', ['Section 138'])).toEqual(['Article 138']);
  });
  it('leaves a document’s own cross-references alone', () => {
    expect(provisions('As per Section 5 of this Agreement the tenant pays rent. Section 7 of the said lease applies.')).toEqual([]);
  });
  it('lists the provision once, never tags it inline, and counts it with the other flags', () => {
    const r = guard('Section 138 of the NI Act applies. Again, Section 138 of the NI Act.', [], true);
    expect(r.flags.filter((f) => f.kind === 'provision')).toHaveLength(1);
    expect(r.text).not.toContain('unverified');
  });
});
