import { describe, expect, it } from 'vitest';
import { hasUsableText, isPdf, readPdf } from '@/lib/pdf/extract';
import { makePdf } from './helpers';

describe('pdf extraction', () => {
  it('reads page count and text from a real PDF', async () => {
    const pdf = makePdf(['IN THE HIGH COURT OF DELHI', 'Writ Petition (C) No. 1 of 2024', 'The petitioner prays for a writ of mandamus.', 'Page two text here.'], 2);
    expect(isPdf(pdf)).toBe(true);
    const info = await readPdf(pdf);
    expect(info.pages).toBe(2);
    expect(info.text).toContain('IN THE HIGH COURT OF DELHI');
    expect(info.text).toContain('Page two text here.');
  });
  it('rejects non-PDF bytes and handles broken files', async () => {
    expect(isPdf(new TextEncoder().encode('<html>not a pdf at all</html>'))).toBe(false);
    await expect(readPdf(new TextEncoder().encode('%PDF-1.4 garbage'))).rejects.toBeDefined();
  });
  it('decides when a text layer is usable', () => {
    expect(hasUsableText('x'.repeat(5000), 10)).toBe(true);
    expect(hasUsableText('x'.repeat(100), 10)).toBe(false); // scanned: only stray characters
    expect(hasUsableText('', 3)).toBe(false);
  });
});
