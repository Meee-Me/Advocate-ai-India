/** The largest file an advocate can upload (PDF, Word, text or photo). Supabase's free plan allows up to 50 MB per file; the 1 GB total is shared by everyone. */
export const MAX_UPLOAD_MB = 50;
export const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;
