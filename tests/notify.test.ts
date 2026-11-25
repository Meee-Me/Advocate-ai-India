import { describe, expect, it } from 'vitest';
import { hearingMessage, whatsappLink } from '@/lib/notify';

describe('whatsappLink', () => {
  it('turns Indian mobile numbers written many ways into one wa.me link', () => {
    for (const n of ['9876543210', '98765 43210', '+91 98765 43210', '098765-43210', '91 9876543210']) {
      expect(whatsappLink(n, 'hi')).toBe('https://wa.me/919876543210?text=hi');
    }
  });
  it('encodes the message, including new lines and Malayalam', () => {
    expect(whatsappLink('9876543210', 'a b\nc')).toBe('https://wa.me/919876543210?text=a%20b%0Ac');
    expect(whatsappLink('9876543210', 'കേസ്')).toContain(encodeURIComponent('കേസ്'));
  });
  it('gives null for a missing or unusable number', () => {
    for (const n of [null, undefined, '', 'abc', '12345', '98765']) expect(whatsappLink(n, 'x')).toBeNull();
  });
});

describe('hearingMessage', () => {
  const base = { clientName: 'Ravi', caseTitle: 'Ravi v. State', caseNumber: 'WP(C) 1234/2024', hearingAt: '2026-11-26T05:00:00.000Z', status: 'scheduled', court: 'High Court of Kerala', courtroom: '3', advocateName: 'Asha Menon' };
  it('says when and where an upcoming hearing is, in India time', () => {
    const m = hearingMessage(base);
    expect(m).toContain('Dear Ravi,');
    expect(m).toContain('"Ravi v. State" (WP(C) 1234/2024) is listed on 26 November 2026 at 10:30 am');
    expect(m).toContain('at High Court of Kerala, Court 3');
    expect(m).toContain('Regards,\nAsha Menon');
  });
  it('reports the outcome of a hearing that has happened, with the advocate’s own note', () => {
    expect(hearingMessage({ ...base, status: 'adjourned', notes: 'Next date 12 December.' })).toContain('was adjourned. Next date 12 December.');
    expect(hearingMessage({ ...base, status: 'completed' })).toContain('has been heard.');
    expect(hearingMessage({ ...base, status: 'cancelled', advocateName: null })).not.toContain('Regards');
  });
});
