-- Offices and juniors.
--   office_members : a junior works inside a senior advocate's practice. The junior signs in with their own login; the site
--                    then reads and writes the senior's data (advocate_id = the senior). One office per person.
--   office_invites : a single-use code the senior gives a junior. Only a hash of the code is stored, and it expires.
--   hearings.assigned_to : which junior (or the senior) covers a hearing (court hall delegation).
--   cases.file_location  : where the physical file is ("Almirah 3, shelf B").
-- Additive only: two new tables and two nullable columns; nothing existing is rewritten.

create table if not exists office_members (
  id          uuid primary key default gen_random_uuid(),
  advocate_id uuid not null references advocates(id) on delete cascade,
  member_id   uuid not null unique references advocates(id) on delete cascade,
  role        text not null default 'junior' check (role in ('junior')),
  created_at  timestamptz not null default now(),
  check (advocate_id <> member_id)
);
create index if not exists office_members_advocate_idx on office_members (advocate_id);

create table if not exists office_invites (
  id          uuid primary key default gen_random_uuid(),
  advocate_id uuid not null references advocates(id) on delete cascade,
  code_hash   text not null unique,
  expires_at  timestamptz not null,
  used_at     timestamptz,
  used_by     uuid references advocates(id) on delete set null,
  created_at  timestamptz not null default now()
);

alter table hearings add column if not exists assigned_to uuid references advocates(id) on delete set null;
alter table cases add column if not exists file_location text;

alter table office_members enable row level security;
alter table office_invites enable row level security;

do $$
declare t text;
begin
  if to_regclass('auth.users') is null then return; end if;   -- Supabase only
  foreach t in array array['office_members','office_invites'] loop
    execute format('drop policy if exists "owner access" on public.%I', t);
    execute format('create policy "owner access" on public.%I for all to authenticated using (advocate_id = (select auth.uid())) with check (advocate_id = (select auth.uid()))', t);
  end loop;
end $$;
