-- Advocate AI India: sign-in moves from Deluxe Main to this project's own Supabase Auth (email + password).
--
-- WHAT THIS CHANGES
--   * advocates.id is now the Supabase Auth user id (auth.users.id). Every other table already points at
--     advocates(id), so each row's advocate_id equals auth.uid() for its owner. The site creates the advocate row on
--     a person's first request (ensureAdvocate); no trigger on the auth schema is needed.
--   * advocates.email is added for display; the two Deluxe columns are kept (nothing is dropped or rewritten) and
--     deluxe_account_id may now be empty, because new people have no Deluxe account.
--   * Supabase only: a foreign key from advocates.id to auth.users (NOT VALID, so any pre-existing row is left
--     alone and only new rows are checked), and owner-only row policies using auth.uid().
--
-- SECURITY POSTURE (unchanged): this site's server is the only client of the database and scopes every query by
-- advocate_id. RLS stays enabled on every table, and anon/authenticated still have NO table privileges (0001), so the
-- public Supabase API reads nothing. The policies below are a SECOND lock: if privileges were ever granted to
-- `authenticated`, each person could still only reach their own rows. They open nothing by themselves.

alter table advocates alter column deluxe_account_id drop not null;
alter table advocates add column if not exists email text;
create index if not exists advocates_email_idx on advocates (lower(email));

-- Supabase-only parts (skipped on plain Postgres / the embedded development database).
do $$
declare
  t text;
  owned text[] := array['clients','cases','case_notes','hearings','notifications','documents',
    'analyses','drafts','draft_versions','conversations','messages','ai_usage'];
begin
  if to_regclass('auth.users') is null then
    return;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'advocates_auth_user_fk') then
    alter table public.advocates
      add constraint advocates_auth_user_fk foreign key (id) references auth.users (id) on delete cascade not valid;
  end if;

  drop policy if exists "own profile" on public.advocates;
  create policy "own profile" on public.advocates
    for all to authenticated
    using (id = (select auth.uid()))
    with check (id = (select auth.uid()));

  foreach t in array owned loop
    execute format('drop policy if exists "owner access" on public.%I', t);
    execute format(
      'create policy "owner access" on public.%I for all to authenticated using (advocate_id = (select auth.uid())) with check (advocate_id = (select auth.uid()))',
      t);
  end loop;
end $$;
