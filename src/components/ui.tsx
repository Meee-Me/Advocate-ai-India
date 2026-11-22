'use client';
import clsx from 'clsx';
import { useEffect, type ComponentProps, type ReactNode } from 'react';

export function Button({ variant = 'primary', size = 'md', className, ...p }: ComponentProps<'button'> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; size?: 'sm' | 'md' }) {
  return (
    <button
      {...p}
      className={clsx(
        'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl font-medium transition active:scale-[.98] disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' ? 'min-h-10 px-3.5 text-sm' : 'min-h-12 px-5 text-base sm:min-h-11 sm:text-sm',
        variant === 'primary' && 'bg-navy text-white shadow-sm hover:bg-navy-soft',
        variant === 'secondary' && 'border border-line bg-card text-ink shadow-sm hover:bg-brass-soft',
        variant === 'ghost' && 'text-navy hover:bg-brass-soft',
        variant === 'danger' && 'border border-danger/30 bg-card text-danger hover:bg-danger-soft',
        className,
      )}
    />
  );
}

export function Card({ className, ...p }: ComponentProps<'div'>) {
  return <div {...p} className={clsx('rounded-2xl border border-line bg-card p-4 shadow-[var(--shadow-soft)] sm:p-6', className)} />;
}

const field = 'w-full rounded-xl border border-line bg-white px-3.5 py-3 text-base text-ink placeholder:text-muted/70 focus:border-navy-soft focus:outline-none focus:ring-4 focus:ring-navy/10 sm:py-2.5 sm:text-sm';
export const Input = (p: ComponentProps<'input'>) => <input {...p} className={clsx(field, p.className)} />;
export const Textarea = (p: ComponentProps<'textarea'>) => <textarea {...p} className={clsx(field, 'min-h-24 leading-relaxed', p.className)} />;
export const Select = (p: ComponentProps<'select'>) => <select {...p} className={clsx(field, p.className)} />;

export function Field({ label, hint, children, className }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <label className={clsx('block space-y-1.5', className)}>
      <span className="text-sm font-semibold text-ink">{label}</span>
      {children}
      {hint && <span className="block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3 border-b border-line pb-5">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold text-navy sm:text-3xl">{title}</h1>
        {subtitle && <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted sm:text-base">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Badge({ tone = 'neutral', children }: { tone?: 'neutral' | 'ok' | 'warn' | 'danger' | 'brass'; children: ReactNode }) {
  return (
    <span className={clsx('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
      tone === 'neutral' && 'bg-ink/5 text-muted', tone === 'ok' && 'bg-ok-soft text-ok', tone === 'warn' && 'bg-warn-soft text-warn',
      tone === 'danger' && 'bg-danger-soft text-danger', tone === 'brass' && 'bg-brass-soft text-brass')}>
      {children}
    </span>
  );
}

export function Alert({ tone = 'danger', children }: { tone?: 'danger' | 'warn' | 'ok'; children: ReactNode }) {
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} className={clsx('rounded-lg border px-3 py-2 text-sm',
      tone === 'danger' && 'border-danger/30 bg-danger-soft text-danger', tone === 'warn' && 'border-warn/30 bg-warn-soft text-warn', tone === 'ok' && 'border-ok/30 bg-ok-soft text-ok')}>
      {children}
    </div>
  );
}

export const Spinner = ({ label = 'Working…' }: { label?: string }) => (
  <span className="inline-flex items-center gap-2 text-sm text-muted" role="status">
    <span className="h-4 w-4 animate-spin rounded-full border-2 border-line border-t-brass" />{label}
  </span>
);

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-line bg-card/60 px-4 py-12 text-center">
      <p className="font-serif text-lg">{title}</p>
      {children && <div className="mx-auto mt-1 max-w-md text-sm text-muted">{children}</div>}
    </div>
  );
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/50 p-0 sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={title} className="max-h-[92dvh] w-full max-w-xl overflow-y-auto rounded-t-2xl bg-card p-5 shadow-xl sm:rounded-2xl">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-xl font-bold">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="rounded-lg p-2 text-muted hover:bg-brass-soft">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export const Disclaimer = () => (
  <p className="rounded-lg border border-line bg-brass-soft/50 px-3 py-2 text-xs text-muted">
    AI output can be wrong or out of date. It may contain errors and is not legal advice. Verify every statute, case and citation on an official or licensed source before relying on it or filing it.
  </p>
);
