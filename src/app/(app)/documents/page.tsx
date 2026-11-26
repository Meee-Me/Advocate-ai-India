'use client';
import Link from 'next/link';
import { Suspense, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { api, errorText, fmtDate, useApi } from '@/components/api';
import { Alert, Badge, Button, Card, Empty, PageHeader, Spinner } from '@/components/ui';
import { MAX_PDF_MB } from '@/lib/limits';

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
    if (!/\.pdf$/i.test(file.name)) return setErr('Only PDF files are supported.');
    if (file.size > MAX_PDF_MB * MB) return setErr(`PDFs up to ${MAX_PDF_MB} MB are supported.`);
    try {
      setStep('Preparing upload…');
      const init = await api<{ document: { id: string }; upload: { url: string; method: string; headers: Record<string, string> } }>('/api/documents', { body: { fileName: file.name, sizeBytes: file.size, caseId } });
      setStep('Uploading…');
      const put = await fetch(init.upload.url, { method: init.upload.method, headers: init.upload.headers, body: file });
      if (!put.ok) throw new Error('The upload failed. Please try again.');
      setStep('Reading the PDF…');
      const done = await api<{ document: { pageCount: number; needsOcr: boolean } }>(`/api/documents/${init.document.id}/finalize`, { body: {} });
      list.mutate();
      if (!done.document.needsOcr) { setNotice(`Uploaded (${done.document.pageCount} pages).`); return; }
      // A scan has no text yet: read it page by page (a few pages per request, so it can resume if interrupted).
      let last: OcrStep = { done: false, pagesDone: 0, pageCount: done.document.pageCount, confidence: null };
      while (!last.done) {
        setStep(`Scanned PDF: reading page ${Math.min(last.pagesDone + 1, last.pageCount)} of ${last.pageCount} (OCR)…`);
        last = await api<OcrStep>(`/api/documents/${init.document.id}/ocr`, { body: { batch: 5 } });
      }
      setNotice(`Uploaded and read ${last.pageCount} scanned pages with OCR (confidence about ${last.confidence ?? '?'}%). OCR can make mistakes, so check important wording against the original.`);
      list.mutate();
    } catch (x) { setErr(errorText(x)); list.mutate(); } finally { setStep(null); if (input.current) input.current.value = ''; }
  };
  return (
    <>
      <PageHeader title="Documents" subtitle="Upload PDFs (judgments, orders, contracts, notices) to summarise and analyse. Files are stored privately and only you can open them." />
      <Card className="mb-5">
        <input ref={input} type="file" accept="application/pdf,.pdf" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} aria-label="Choose a PDF" />
        <div className="flex flex-wrap items-center gap-3"><Button onClick={() => input.current?.click()} disabled={!!step}>Upload a PDF</Button><span className="text-sm text-muted">PDF, up to {MAX_PDF_MB} MB{caseId ? ' · will be linked to the case' : ''}</span>{step && <Spinner label={step} />}</div>
        {err && <div className="mt-3"><Alert>{err}</Alert></div>}{notice && <div className="mt-3"><Alert tone="ok">{notice}</Alert></div>}
      </Card>
      {list.data?.documents.length === 0 && <Empty title="No documents yet">Your uploaded PDFs will be listed here.</Empty>}
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
