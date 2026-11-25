'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import clsx from 'clsx';
import { fmtDate, useApi } from '@/components/api';
import { Button, Spinner } from '@/components/ui';
import { KIND_LABEL, formatRupees, type FeeKind } from '@/lib/money';

interface Inv {
  invoice: { number: string; issuedOn: string; totalPaise: number; note: string | null };
  client: { name: string; address: string | null; phone: string | null };
  advocate: { displayName: string; enrolmentNumber: string | null; barCouncil: string | null; phone: string | null; city: string | null; state: string | null };
  items: { id: string; kind: FeeKind; amountPaise: number; incurredOn: string; note: string | null; caseTitle: string | null; caseNumber: string | null }[];
}

/** A plain fee invoice for the client. "Print / Save as PDF" uses the browser; the menus are hidden when printing. */
export default function InvoicePage() {
  const { id } = useParams<{ id: string }>();
  const { data, error } = useApi<Inv>(`/api/billing/invoices/${id}`);
  if (error) return <p role="alert" className="text-danger">{error.message}</p>;
  if (!data) return <Spinner label="Loading…" />;
  const { invoice: inv, client, advocate: a, items } = data;
  return (
    <>
      <div className="no-print mb-4 flex flex-wrap gap-2"><Link href="/billing"><Button variant="secondary">Back to billing</Button></Link><Button onClick={() => window.print()}>Print / Save as PDF</Button></div>
      <article className="mx-auto max-w-3xl rounded-2xl border border-line bg-card p-6 shadow-[var(--shadow-soft)] print:border-0 print:p-0 print:shadow-none sm:p-10">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-line pb-5">
          <div>
            <h1 className="font-serif text-2xl font-bold">{a.displayName}</h1>
            <p className="text-sm text-muted">Advocate{a.enrolmentNumber ? ` · Enrolment no. ${a.enrolmentNumber}` : ''}{a.barCouncil ? ` · ${a.barCouncil}` : ''}</p>
            <p className="text-sm text-muted">{[a.city, a.state, a.phone].filter(Boolean).join(' · ')}</p>
          </div>
          <div className="text-right"><p className="font-serif text-xl font-bold text-navy">Invoice {inv.number}</p><p className="text-sm text-muted">{fmtDate(inv.issuedOn)}</p></div>
        </header>
        <section className="py-5"><p className="text-sm text-muted">Billed to</p><p className="font-medium">{client.name}</p>{client.address && <p className="whitespace-pre-line text-sm text-muted">{client.address}</p>}</section>
        <table className="w-full text-sm">
          <thead><tr className="border-b border-line text-left text-muted"><th className="py-2 font-medium">Date</th><th className="py-2 font-medium">Particulars</th><th className="py-2 text-right font-medium">Amount</th></tr></thead>
          <tbody>
            {items.map((i) => (
              <tr key={i.id} className="border-b border-line align-top">
                <td className="py-2.5 pr-3 tabular-nums">{fmtDate(i.incurredOn)}</td>
                <td className="py-2.5 pr-3"><span className="font-medium">{KIND_LABEL[i.kind]}</span>{(i.caseTitle || i.note) && <span className="block text-muted">{[i.caseTitle && `${i.caseTitle}${i.caseNumber ? ` (${i.caseNumber})` : ''}`, i.note].filter(Boolean).join(' · ')}</span>}</td>
                <td className={clsx('py-2.5 text-right tabular-nums')}>{formatRupees(i.amountPaise)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr><td colSpan={2} className="pt-4 text-right font-semibold">Total</td><td className="pt-4 text-right font-serif text-xl font-bold tabular-nums">{formatRupees(inv.totalPaise)}</td></tr></tfoot>
        </table>
        {inv.note && <p className="mt-6 text-sm">{inv.note}</p>}
        <p className="mt-8 text-xs text-muted">This is a fee note prepared from the advocate&apos;s own records. Add any GST or TDS particulars that apply to you before issuing it.</p>
      </article>
    </>
  );
}
