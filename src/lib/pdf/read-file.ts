import { MAX_TEXT_CHARS, hasUsableText, isPdf, readPdf } from './extract';
import type { DocKind } from '@/lib/documents';

/** A file that cannot be used, with a message the advocate can act on. */
export class FileProblem extends Error {}

export interface FileInfo { pages: number | null; text: string; needsOcr: boolean }

const startsWith = (b: Uint8Array, sig: number[]) => b.length >= sig.length && sig.every((v, i) => b[i] === v);
const tidy = (s: string) => s.replace(/\u0000/g, '').replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

/**
 * Checks that the bytes really are what the file name claims (never trust the name), and reads their text.
 * Photos have no text yet: they are marked for OCR, which reads them on this server (Tesseract).
 */
export async function readFile(kind: DocKind, bytes: Uint8Array): Promise<FileInfo> {
  switch (kind.id) {
    case 'pdf': {
      if (!isPdf(bytes)) throw new FileProblem('That file is not a valid PDF.');
      let info;
      try { info = await readPdf(bytes); } catch { throw new FileProblem('That PDF could not be read. It may be damaged or password-protected.'); }
      return { pages: info.pages, text: info.text, needsOcr: !hasUsableText(info.text, info.pages) };
    }
    case 'docx': {
      if (!startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) throw new FileProblem('That file is not a valid Word (.docx) document. Older .doc files are not supported: save it as .docx first.');
      let text: string;
      try {
        const { default: mammoth } = await import('mammoth');
        text = tidy((await mammoth.extractRawText({ buffer: Buffer.from(bytes) })).value);
      } catch { throw new FileProblem('That Word document could not be read. It may be damaged or password-protected.'); }
      if (!text) throw new FileProblem('That Word document has no text in it.');
      return { pages: null, text: text.slice(0, MAX_TEXT_CHARS), needsOcr: false };
    }
    case 'txt': {
      if (bytes.subarray(0, 4096).includes(0)) throw new FileProblem('That does not look like a plain text file.');
      const text = tidy(new TextDecoder('utf-8').decode(bytes));
      if (!text) throw new FileProblem('That text file is empty.');
      return { pages: null, text: text.slice(0, MAX_TEXT_CHARS), needsOcr: false };
    }
    case 'png':
      if (!startsWith(bytes, [0x89, 0x50, 0x4e, 0x47])) throw new FileProblem('That file is not a valid PNG image.');
      return { pages: 1, text: '', needsOcr: true };
    case 'jpg':
      if (!startsWith(bytes, [0xff, 0xd8, 0xff])) throw new FileProblem('That file is not a valid JPEG image.');
      return { pages: 1, text: '', needsOcr: true };
  }
}
