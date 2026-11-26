-- Allow files up to 50 MB (was 25 MB) and more kinds of file: PDF, Word (.docx), plain text, and PNG or JPEG photos.
-- Supabase's free plan caps a single file at 50 MB. Only the storage bucket's settings change.
do $$
begin
  if to_regclass('storage.buckets') is not null then
    update storage.buckets
       set file_size_limit = 52428800,
           allowed_mime_types = array['application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document','text/plain','image/png','image/jpeg']
     where id = 'case-documents';
  end if;
end $$;
