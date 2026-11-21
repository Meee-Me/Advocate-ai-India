import { z } from 'zod';

/**
 * Sign-in form rules, shared by the pages (instant feedback) and the server (the real check).
 * Supabase also enforces its own minimum password length; set it to 10 or more in the dashboard too.
 */
export const PASSWORD_MIN = 10;
/** bcrypt, which Supabase uses for passwords, only reads the first 72 bytes. */
export const PASSWORD_MAX_BYTES = 72;

export const passwordRules = [
  { id: 'length', label: `At least ${PASSWORD_MIN} characters`, test: (p: string) => p.length >= PASSWORD_MIN },
  { id: 'letter', label: 'At least one letter', test: (p: string) => /\p{L}/u.test(p) },
  { id: 'number', label: 'At least one number', test: (p: string) => /\d/.test(p) },
] as const;

export const passwordProblems = (password: string): string[] => {
  const unmet = passwordRules.filter((r) => !r.test(password)).map((r) => r.label.toLowerCase());
  if (new TextEncoder().encode(password).length > PASSWORD_MAX_BYTES) unmet.push(`no more than ${PASSWORD_MAX_BYTES} bytes`);
  return unmet;
};

export const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const email = z.string({ error: 'Enter your email address.' }).trim().toLowerCase().max(254, 'That email address is too long.')
  .regex(emailPattern, 'Enter a valid email address, like name@example.com.');

const newPassword = z.string({ error: 'Choose a password.' }).superRefine((value, ctx) => {
  const problems = passwordProblems(value);
  if (problems.length) ctx.addIssue({ code: 'custom', message: `Your password needs ${problems.join(', ')}.` });
});

const sameAs = <T extends { password: string; confirmPassword: string }>(v: T, ctx: z.RefinementCtx) => {
  if (v.password !== v.confirmPassword) ctx.addIssue({ code: 'custom', path: ['confirmPassword'], message: 'The two passwords do not match.' });
};

export const registerSchema = z.object({
  fullName: z.string({ error: 'Enter your full name.' }).trim().min(2, 'Enter your full name.').max(100, 'That name is too long.'),
  email,
  password: newPassword,
  confirmPassword: z.string({ error: 'Confirm your password.' }),
}).superRefine(sameAs);

export const loginSchema = z.object({
  email,
  // No strength rules at sign-in: an older password must still work.
  password: z.string({ error: 'Enter your password.' }).min(1, 'Enter your password.').max(1024),
  remember: z.boolean().default(false),
});

export const forgotSchema = z.object({ email });

export const resetSchema = z.object({
  password: newPassword,
  confirmPassword: z.string({ error: 'Confirm your password.' }),
}).superRefine(sameAs);

/** The first problem in a failed parse, as a message a person can act on. */
export const firstIssue = (error: z.ZodError): { message: string; field?: string } => {
  const issue = error.issues[0];
  return { message: issue?.message ?? 'Please check what you entered.', field: issue?.path?.[0] as string | undefined };
};
