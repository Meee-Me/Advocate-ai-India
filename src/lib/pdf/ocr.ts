import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ocrLanguages } from '@/lib/config';

/**
 * OCR for scanned PDFs: each page is drawn to an image (pdf.js + a native canvas) and read by
 * Tesseract running locally (WebAssembly). Nothing is sent to any outside service. Language data
 * comes from the installed @tesseract.js-data/* packages, so no download happens at run time.
 * To add a language: install @tesseract.js-data/<code>, add it below, and list it in OCR_LANGUAGES.
 */
const PACKS: Record<string, () => Promise<{ langPath?: string; default?: { langPath?: string } }>> = {
  eng: () => import('@tesseract.js-data/eng'),
  hin: () => import('@tesseract.js-data/hin'),
};

export interface OcrPage { page: number; text: string; confidence: number }

/** Copies the needed .traineddata.gz files into one folder (Tesseract takes a single language folder). */
async function languageDir(langs: string[]): Promise<string> {
  const dir = path.join(os.tmpdir(), `advocate-tessdata-${langs.join('-')}`);
  await fs.mkdir(dir, { recursive: true });
  for (const lang of langs) {
    const target = path.join(dir, `${lang}.traineddata.gz`);
    const have = await fs.stat(target).then((s) => s.size > 0).catch(() => false);
    if (have) continue;
    const load = PACKS[lang];
    if (!load) throw new Error(`OCR language "${lang}" is not installed`);
    const mod = await load();
    const langPath = mod.langPath ?? mod.default?.langPath;
    if (!langPath) throw new Error(`OCR language pack "${lang}" has no data folder`);
    await fs.copyFile(path.join(langPath, `${lang}.traineddata.gz`), target);
  }
  return dir;
}

export const normalizeOcrText = (text: string) =>
  text.replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

/** OCRs pages [from, to] (1-based, inclusive) of a PDF. */
export async function ocrPages(bytes: Uint8Array, from: number, to: number, opts: { languages?: string[]; scale?: number } = {}): Promise<OcrPage[]> {
  const langs = opts.languages ?? ocrLanguages();
  const [{ getDocumentProxy, renderPageAsImage }, { createWorker }] = await Promise.all([import('unpdf'), import('tesseract.js')]);
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const worker = await createWorker(langs.join('+'), 1, { langPath: await languageDir(langs), gzip: true, cacheMethod: 'none' });
  try {
    const out: OcrPage[] = [];
    for (let n = from; n <= Math.min(to, pdf.numPages); n++) {
      const png = await renderPageAsImage(pdf, n, { canvasImport: () => import('@napi-rs/canvas'), scale: opts.scale ?? 2 });
      const { data } = await worker.recognize(Buffer.from(png));
      out.push({ page: n, text: normalizeOcrText(data.text), confidence: Math.round(data.confidence) });
    }
    return out;
  } finally {
    await worker.terminate();
    await (pdf as unknown as { destroy?: () => Promise<void> }).destroy?.();
  }
}

/** OCRs one photo (PNG or JPEG) as a single page. Read on this server; nothing leaves it. */
export async function ocrImage(bytes: Uint8Array, opts: { languages?: string[] } = {}): Promise<OcrPage[]> {
  const langs = opts.languages ?? ocrLanguages();
  const { createWorker } = await import('tesseract.js');
  const worker = await createWorker(langs.join('+'), 1, { langPath: await languageDir(langs), gzip: true, cacheMethod: 'none' });
  try {
    const { data } = await worker.recognize(Buffer.from(bytes));
    return [{ page: 1, text: normalizeOcrText(data.text), confidence: Math.round(data.confidence) }];
  } finally {
    await worker.terminate();
  }
}
