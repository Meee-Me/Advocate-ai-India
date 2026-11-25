-- Billing: fees, expenses and payments per client, and numbered invoices.
-- New tables only; nothing existing is changed. Money is stored in paise (integers), so there is no rounding.
--   charges  : professional_fee, court_fee, expense   (what the client owes)
--   credits  : retainer, payment                      (what the client has paid)
-- A client who has fee entries or invoices cannot be deleted (restrict), so financial records are never lost silently.

create table if not exists invoices (
  id           uuid primary key default gen_random_uuid(),
  advocate_id  uuid not null references advocates(id) on delete cascade,
  client_id    uuid not null references clients(id) on delete restrict,
  seq          integer not null,
  number       text not null,
  issued_on    date not null,
  total_paise  bigint not null check (total_paise > 0),
  note         text,
  created_at   timestamptz not null default now(),
  unique (advocate_id, seq)
);

create table if not exists fee_entries (
  id            uuid primary key default gen_random_uuid(),
  advocate_id   uuid not null references advocates(id) on delete cascade,
  client_id     uuid not null references clients(id) on delete restrict,
  case_id       uuid references cases(id) on delete set null,
  invoice_id    uuid references invoices(id) on delete restrict,
  kind          text not null check (kind in ('professional_fee','court_fee','expense','retainer','payment')),
  amount_paise  bigint not null check (amount_paise > 0),
  incurred_on   date not null,
  note          text,
  created_at    timestamptz not null default now()
);
create index if not exists fee_entries_client_idx on fee_entries (advocate_id, client_id, incurred_on);
create index if not exists fee_entries_invoice_idx on fee_entries (invoice_id);

-- Same posture as every other table: RLS on with no public access; the server scopes each query by advocate_id.
alter table invoices enable row level security;
alter table fee_entries enable row level security;

do $$
declare t text;
begin
  if to_regclass('auth.users') is null then return; end if;   -- Supabase only
  foreach t in array array['invoices','fee_entries'] loop
    execute format('drop policy if exists "owner access" on public.%I', t);
    execute format('create policy "owner access" on public.%I for all to authenticated using (advocate_id = (select auth.uid())) with check (advocate_id = (select auth.uid()))', t);
  end loop;
end $$;
