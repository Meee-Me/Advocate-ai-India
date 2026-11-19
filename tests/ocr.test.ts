import { describe, expect, it } from 'vitest';
import { hasUsableText, isPdf, readPdf } from '@/lib/pdf/extract';
import { ocrPages } from '@/lib/pdf/ocr';
import { makeScannedPdf } from './helpers';

describe('OCR of a scanned PDF (no text layer)', () => {
  it('is detected as scanned, then read back page by page by local OCR', async () => {
    const pdf = await makeScannedPdf([
      ['IN THE HIGH COURT OF DELHI', 'Writ Petition No. 1234 of 2024', 'The petitioner prays for a writ of mandamus.'],
      ['SECOND PAGE', 'The respondent shall file a reply within four weeks.'],
    ]);
    expect(isPdf(pdf)).toBe(true);
    const info = await readPdf(pdf);
    expect(info.pages).toBe(2);
    expect(hasUsableText(info.text, info.pages)).toBe(false); // nothing for the text extractor: needs OCR

    const t0 = Date.now();
    const pages = await ocrPages(pdf, 1, 2, { languages: ['eng'] });
    console.log(`OCR took ${Date.now() - t0} ms for 2 pages`);
    expect(pages.map((p) => p.page)).toEqual([1, 2]);
    expect(pages[0].text.toUpperCase()).toContain('HIGH COURT OF DELHI');
    expect(pages[0].text).toMatch(/1234 of 2024/i);
    expect(pages[1].text.toLowerCase()).toContain('reply within four weeks');
    expect(pages[0].confidence).toBeGreaterThan(60);
  }, 180_000);

  it('can read a single later page (resumable batches) and loads the Hindi pack', async () => {
    const pdf = await makeScannedPdf([['PAGE ONE'], ['PAGE TWO TEXT']]);
    const only2 = await ocrPages(pdf, 2, 2, { languages: ['eng', 'hin'] });
    expect(only2).toHaveLength(1);
    expect(only2[0].page).toBe(2);
    expect(only2[0].text.toUpperCase()).toContain('PAGE TWO');
  }, 180_000);
});
