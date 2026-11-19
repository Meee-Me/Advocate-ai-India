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
