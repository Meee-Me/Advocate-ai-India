import { extractText, getDocumentProxy } from 'unpdf';

export const MAX_PDF_BYTES = 25 * 1024 * 1024;
export const MAX_TEXT_CHARS = 1_500_000;

export const isPdf = (bytes: Uint8Array) =>
  bytes.length > 8 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d; // "%PDF-"

export interface PdfInfo { pages: number; text: string }

/**
 * Reads the text layer of a PDF. Scanned judgments have none (text is empty or tiny);
 * those are sent to Claude as the PDF itself so it can read the page images.
 */
export async function readPdf(bytes: Uint8Array): Promise<PdfInfo> {
  const pdf = await getDocumentProxy(new Uint8Array(bytes)); // copy: pdf.js takes ownership of the buffer
  try {
    const { totalPages, text } = await extractText(pdf, { mergePages: true });
    const merged = (Array.isArray(text) ? text.join('\n') : text).replace(/\u0000/g, '').replace(/[ \t]+\n/g, '\n').trim();
    return { pages: totalPages, text: merged.slice(0, MAX_TEXT_CHARS) };
  } finally {
    await (pdf as unknown as { destroy?: () => Promise<void> }).destroy?.();
  }
}

/** Text worth sending as text: at least ~200 characters per page on average. */
export const hasUsableText = (text: string | null | undefined, pages: number | null | undefined) =>
  !!text && text.length >= Math.max(400, (pages ?? 1) * 200);
