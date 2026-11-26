'use client';
import Link from 'next/link';
import { Suspense, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { api, errorText, fmtDate, useApi } from '@/components/api';
import { Alert, Badge, Button, Card, Empty, PageHeader, Spinner } from '@/components/ui';
import { MAX_UPLOAD_MB } from '@/lib/limits';
import { ACCEPT, SUPPORTED_TEXT, isImageMime, kindOfName } from '@/lib/documents';

interface Doc { id: string; title: string; fileName: string; status: string; pageCount: number | null; sizeBytes: number; createdAt: string; textChars: number; needsOcr: boolean; ocrPagesDone: number }
interface OcrStep { done: boolean; pagesDone: number; pageCount: number; confidence: number | null }
const MB = 1024 * 1024;

function Inner() {
  const caseId = useSearchParams().get('caseId');
  const list = useApi<{ documents: Doc[] }>(`/api/documents${caseId ? `?caseId=${caseId}` : ''}`);
  const input = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const upload = async (file: File) => {
    setErr(null); setNotice(null);
    const kind = kindOfName(file.name);
    if (!kind) return setErr(`Supported files: ${SUPPORTED_TEXT}.`);
    if (file.size > MAX_UPLOAD_MB * MB) return setErr(`Files up to ${MAX_UPLOAD_MB} MB are supported.`);
    const photo = isImageMime(kind.mime);
    try {
      setStep('Preparing upload…');
      const init = await api<{ document: { id: string }; upload: { url: string; method: string; headers: Record<string, string> } }>('/api/documents', { body: { fileName: file.name, sizeBytes: file.size, caseId } });
      setStep('Uploading…');
      const put = await fetch(init.upload.url, { method: init.upload.method, headers: init.upload.headers, body: file });
      if (!put.ok) throw new Error('The upload failed. Please try again.');
      setStep(photo ? 'Reading the photo (OCR)…' : 'Reading the file…');
      const done = await api<{ document: { pageCount: number; needsOcr: boolean } }>(`/api/documents/${init.document.id}/finalize`, { body: {} });
      list.mutate();
      if (!done.document.needsOcr) { setNotice(done.document.pageCount ? `Uploaded (${done.document.pageCount} pages).` : 'Uploaded.'); return; }
      // A scan has no text yet: read it page by page (a few pages per request, so it can resume if interrupted).
      let last: OcrStep = { done: false, pagesDone: 0, pageCount: done.document.pageCount, confidence: null };
      while (!last.done) {
        setStep(photo ? 'Reading the photo (OCR)…' : `Scanned PDF: reading page ${Math.min(last.pagesDone + 1, last.pageCount)} of ${last.pageCount} (OCR)…`);
        last = await api<OcrStep>(`/api/documents/${init.document.id}/ocr`, { body: { batch: 5 } });
      }
      setNotice(`Uploaded and read ${photo ? 'the photo' : `${last.pageCount} scanned pages`} with OCR (confidence about ${last.confidence ?? '?'}%). OCR can make mistakes, so check important wording against the original.`);
      list.mutate();
    } catch (x) { setErr(errorText(x)); list.mutate(); } finally { setStep(null); if (input.current) input.current.value = ''; }
  };
  return (
    <>
      <PageHeader title="Documents" subtitle="Upload judgments, orders, contracts and notices to summarise and analyse. Files are stored privately and only you can open them." />
      <Card className="mb-5">
        <input ref={input} type="file" accept={ACCEPT} className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} aria-label="Choose a file" />
        <div className="flex flex-wrap items-center gap-3"><Button onClick={() => input.current?.click()} disabled={!!step}>Upload a file</Button><span className="text-sm text-muted">{SUPPORTED_TEXT}, up to {MAX_UPLOAD_MB} MB{caseId ? ' · will be linked to the case' : ''}</span>{step && <Spinner label={step} />}</div>
        {err && <div className="mt-3"><Alert>{err}</Alert></div>}{notice && <div className="mt-3"><Alert tone="ok">{notice}</Alert></div>}
      </Card>
      {list.data?.documents.length === 0 && <Empty title="No documents yet">Your uploaded files will be listed here.</Empty>}
      <div className="grid gap-3 sm:grid-cols-2">
        {list.data?.documents.map((d) => (
          <Link key={d.id} href={`/documents/${d.id}`}><Card className="hover:border-brass">
            <p className="truncate font-serif text-lg font-bold">📄 {d.title}</p>
            <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">{d.pageCount ? `${d.pageCount} pages` : ''} · {(d.sizeBytes / MB).toFixed(1)} MB · {fmtDate(d.createdAt)}
              <Badge tone={d.status === 'uploaded' ? 'ok' : d.status === 'failed' ? 'danger' : 'warn'}>{d.status === 'uploaded' ? (d.needsOcr && d.ocrPagesDone < (d.pageCount ?? 0) ? `scan: OCR ${d.ocrPagesDone}/${d.pageCount}` : 'ready') : d.status.replace('_', ' ')}</Badge></p>
          </Card></Link>
        ))}
      </div>
    </>
  );
}
export default function Documents() { return <Suspense><Inner /></Suspense>; }
