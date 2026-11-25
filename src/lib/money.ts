/** Money is kept in paise (whole numbers). These turn what a person types into paise and back. */

export const CHARGE_KINDS = ['professional_fee', 'court_fee', 'expense'] as const;
export const CREDIT_KINDS = ['retainer', 'payment'] as const;
export const FEE_KINDS = [...CHARGE_KINDS, ...CREDIT_KINDS] as const;
export type FeeKind = (typeof FEE_KINDS)[number];
export const isCharge = (k: string) => (CHARGE_KINDS as readonly string[]).includes(k);

export const KIND_LABEL: Record<FeeKind, string> = {
  professional_fee: 'Professional fee', court_fee: 'Court fee', expense: 'Expense', retainer: 'Retainer received', payment: 'Payment received',
};

const MAX_PAISE = 1_000_000_000_00; // ₹100 crore: a typing mistake guard, far above any real fee

/** "1,50,000", "₹1500.50", "1500" -> paise. Returns null when it is not a positive amount with at most two decimals. */
export function rupeesToPaise(input: string | number): number | null {
  const s = String(input).replace(/[₹,\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [r, p = ''] = s.split('.');
  const paise = Number(r) * 100 + Number(p.padEnd(2, '0'));
  return paise > 0 && paise <= MAX_PAISE ? paise : null;
}

/** 12500050 -> "₹1,25,000.50" (Indian digit grouping). Whole rupees drop the ".00". */
export function formatRupees(paise: number): string {
  const sign = paise < 0 ? '-' : '';
  const abs = Math.abs(paise);
  const whole = new Intl.NumberFormat('en-IN').format(Math.floor(abs / 100));
  const frac = abs % 100;
  return `${sign}₹${whole}${frac ? `.${String(frac).padStart(2, '0')}` : ''}`;
}
