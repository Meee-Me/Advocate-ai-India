import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { schema, setDb, type Db } from '@/lib/db';

/** A fresh in-memory Postgres (PGlite) with the real migrations applied. */
export async function freshDb(): Promise<{ db: Db; client: PGlite }> {
  const client = new PGlite();
  await client.waitReady;
  const dir = path.join(process.cwd(), 'supabase', 'migrations');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
    await client.exec(fs.readFileSync(path.join(dir, f), 'utf8'));
  }
  const db = drizzle(client, { schema }) as unknown as Db;
  setDb(db);
  return { db, client };
}

/** Builds a small valid PDF whose text layer contains the given lines (one per page chunk). */
export function makePdf(lines: string[], pages = 1): Uint8Array {
  const esc = (s: string) => s.replace(/[\\()]/g, '\\$&');
  const objs: string[] = [];
  const kids: number[] = [];
  const perPage = Math.ceil(lines.length / pages);
  objs.push(''); // 1 catalog (filled below)
  objs.push(''); // 2 pages
  objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'); // 3 font
  for (let p = 0; p < pages; p++) {
    const chunk = lines.slice(p * perPage, (p + 1) * perPage);
    const stream = 'BT /F1 11 Tf 40 780 Td 14 TL ' + chunk.map((l) => `(${esc(l)}) Tj T*`).join(' ') + ' ET';
    const contentNo = objs.length + 2;
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentNo} 0 R >>`);
    kids.push(objs.length);
    objs.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  }
  objs[0] = '<< /Type /Catalog /Pages 2 0 R >>';
  objs[1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${pages} >>`;
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}

/**
 * A PDF with NO text layer: each page is a bitmap of printed-looking text, like a scan.
 * Returns the PDF and the lines drawn, so tests can check what OCR reads back.
 */
export async function makeScannedPdf(pages: string[][]): Promise<Uint8Array> {
  const { createCanvas } = await import('@napi-rs/canvas');
  const { deflateSync } = await import('node:zlib');
  const W = 1240, H = 1754; // A4 at 150 dpi
  const objs: (string | Buffer)[] = ['', '', ''];
  const kids: number[] = [];
  for (const lines of pages) {
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#000'; ctx.font = '44px sans-serif';
    lines.forEach((l, i) => ctx.fillText(l, 100, 160 + i * 80));
    const rgba = ctx.getImageData(0, 0, W, H).data;
    const rgb = Buffer.alloc(W * H * 3);
    for (let i = 0, j = 0; i < rgba.length; i += 4) { rgb[j++] = rgba[i]; rgb[j++] = rgba[i + 1]; rgb[j++] = rgba[i + 2]; }
    const img = deflateSync(rgb);
    const imgNo = objs.length + 1;
    objs.push(Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${W} /Height ${H} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ${img.length} >>\nstream\n`), img, Buffer.from('\nendstream')]));
    const content = `q 595 0 0 842 0 0 cm /Im0 Do Q`;
    const contentNo = objs.length + 1;
    objs.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    kids.push(objs.length + 1);
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /Im0 ${imgNo} 0 R >> >> /Contents ${contentNo} 0 R >>`);
  }
  objs[0] = '<< /Type /Catalog /Pages 2 0 R >>';
  objs[1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${pages.length} >>`;
  objs[2] = '<< >>';
  const parts: Buffer[] = [Buffer.from('%PDF-1.4\n')];
  const offsets: number[] = [];
  let pos = parts[0].length;
  objs.forEach((o, i) => {
    offsets.push(pos);
    const b = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`), Buffer.isBuffer(o) ? o : Buffer.from(o), Buffer.from('\nendobj\n')]);
    parts.push(b); pos += b.length;
  });
  const xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  parts.push(Buffer.from(`${xref}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${pos}\n%%EOF\n`));
  return new Uint8Array(Buffer.concat(parts));
}
