/** The largest PDF an advocate can upload. Supabase's free plan allows up to 50 MB per file; the 1 GB total is shared by everyone. */
export const MAX_PDF_MB = 50;
export const MAX_PDF_BYTES = MAX_PDF_MB * 1024 * 1024;
