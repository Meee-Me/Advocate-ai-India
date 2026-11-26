-- Allow PDFs up to 50 MB (was 25 MB). Supabase's free plan caps a single file at 50 MB. Only the bucket's size limit changes.
do $$
begin
  if to_regclass('storage.buckets') is not null then
    update storage.buckets set file_size_limit = 52428800 where id = 'case-documents';
  end if;
end $$;
