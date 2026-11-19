-- Advocate AI India: initial schema.
--
-- Identity comes from Deluxe Main, not Supabase Auth. An "advocate" row is
-- created on first sign-in and keyed by the Deluxe account id. The server is the
-- only client of this database (direct connection / service role) and scopes every
-- query by advocate_id. Row Level Security is enabled with NO policies on every
-- table, so the public Supabase API (anon / authenticated keys) can read nothing.

create or replace function set_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

create table advocates (
  id                 uuid primary key default gen_random_uuid(),
  deluxe_account_id  text not null unique,
  deluxe_handle      text,
  display_name       text not null,
  enrolment_number   text,
  bar_council        text,
  phone              text,
  city               text,
  state              text,
  bio                text,
  practice_areas     text[] not null default '{}',
  courts             text[] not null default '{}',
  languages          text[] not null default '{english}',
  preferred_language text not null default 'english',
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  last_login_at      timestamptz
);

create table clients (
  id          uuid primary key default gen_random_uuid(),
  advocate_id uuid not null references advocates(id) on delete cascade,
  name        text not null,
  email       text,
  phone       text,
  address     text,
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index clients_advocate_name_idx on clients (advocate_id, lower(name));

create table cases (
  id              uuid primary key default gen_random_uuid(),
  advocate_id     uuid not null references advocates(id) on delete cascade,
  client_id       uuid references clients(id) on delete set null,
  title           text not null,
  case_number     text,
  cnr_number      text,
  court           text,
  case_type       text,
  status          text not null default 'open' check (status in ('open','pending','disposed','archived')),
  stage           text,
  our_side        text,
  petitioner      text,
  respondent      text,
  opposing_counsel text,
  judge           text,
  filing_date     date,
  description     text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index cases_advocate_idx on cases (advocate_id, status, updated_at desc);
create index cases_client_idx on cases (client_id);

create table case_notes (
  id          uuid primary key default gen_random_uuid(),
  advocate_id uuid not null references advocates(id) on delete cascade,
  case_id     uuid not null references cases(id) on delete cascade,
  body        text not null,
  created_at  timestamptz not null default now()
);
create index case_notes_case_idx on case_notes (case_id, created_at desc);

create table hearings (
  id                    uuid primary key default gen_random_uuid(),
  advocate_id           uuid not null references advocates(id) on delete cascade,
  case_id               uuid not null references cases(id) on delete cascade,
  hearing_at            timestamptz not null,
  purpose               text,
  court                 text,
  courtroom             text,
  status                text not null default 'scheduled' check (status in ('scheduled','completed','adjourned','cancelled')),
  notes                 text,
  remind_before_minutes integer not null default 1440 check (remind_before_minutes between 0 and 43200),
  reminded_at           timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index hearings_advocate_time_idx on hearings (advocate_id, hearing_at);
create index hearings_due_idx on hearings (hearing_at) where status = 'scheduled' and reminded_at is null;

create table notifications (
  id          uuid primary key default gen_random_uuid(),
  advocate_id uuid not null references advocates(id) on delete cascade,
  kind        text not null,
  title       text not null,
  body        text,
  hearing_id  uuid references hearings(id) on delete cascade,
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index notifications_advocate_idx on notifications (advocate_id, created_at desc);

create table documents (
  id             uuid primary key default gen_random_uuid(),
  advocate_id    uuid not null references advocates(id) on delete cascade,
  case_id        uuid references cases(id) on delete set null,
  title          text not null,
  file_name      text not null,
  mime_type      text not null,
  size_bytes     bigint not null default 0,
  storage_path   text not null,
  status         text not null default 'pending_upload' check (status in ('pending_upload','uploaded','failed')),
  page_count     integer,
  extracted_text text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index documents_advocate_idx on documents (advocate_id, created_at desc);

-- Saved AI results: summaries, contract / judgment analyses, research, translations.
create table analyses (
  id          uuid primary key default gen_random_uuid(),
  advocate_id uuid not null references advocates(id) on delete cascade,
  document_id uuid references documents(id) on delete cascade,
  case_id     uuid references cases(id) on delete set null,
  kind        text not null check (kind in ('summary','contract','judgment','research','translation')),
  title       text not null,
  result      jsonb not null,
  model       text,
  created_at  timestamptz not null default now()
);
create index analyses_advocate_idx on analyses (advocate_id, created_at desc);
create index analyses_document_idx on analyses (document_id);

create table drafts (
  id          uuid primary key default gen_random_uuid(),
  advocate_id uuid not null references advocates(id) on delete cascade,
  case_id     uuid references cases(id) on delete set null,
  title       text not null,
  doc_type    text not null default 'custom',
  language    text not null default 'english',
  content     text not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index drafts_advocate_idx on drafts (advocate_id, updated_at desc);

create table draft_versions (
  id          uuid primary key default gen_random_uuid(),
  draft_id    uuid not null references drafts(id) on delete cascade,
  advocate_id uuid not null references advocates(id) on delete cascade,
  content     text not null,
  note        text,
  created_at  timestamptz not null default now()
);
create index draft_versions_draft_idx on draft_versions (draft_id, created_at desc);

create table conversations (
  id          uuid primary key default gen_random_uuid(),
  advocate_id uuid not null references advocates(id) on delete cascade,
  case_id     uuid references cases(id) on delete set null,
  title       text not null default 'New conversation',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index conversations_advocate_idx on conversations (advocate_id, updated_at desc);

create table messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  advocate_id     uuid not null references advocates(id) on delete cascade,
  role            text not null check (role in ('user','assistant')),
  content         text not null,
  flags           jsonb not null default '[]',
  model           text,
  created_at      timestamptz not null default now()
);
create index messages_conversation_idx on messages (conversation_id, created_at);

-- Per-advocate AI usage, for daily limits that work across serverless instances.
create table ai_usage (
  id            bigint generated always as identity primary key,
  advocate_id   uuid not null references advocates(id) on delete cascade,
  kind          text not null,
  model         text,
  input_tokens  integer not null default 0,
  output_tokens integer not null default 0,
  created_at    timestamptz not null default now()
);
create index ai_usage_advocate_idx on ai_usage (advocate_id, created_at desc);

-- updated_at triggers
create trigger advocates_updated before update on advocates for each row execute function set_updated_at();
create trigger clients_updated before update on clients for each row execute function set_updated_at();
create trigger cases_updated before update on cases for each row execute function set_updated_at();
create trigger hearings_updated before update on hearings for each row execute function set_updated_at();
create trigger documents_updated before update on documents for each row execute function set_updated_at();
create trigger drafts_updated before update on drafts for each row execute function set_updated_at();
create trigger conversations_updated before update on conversations for each row execute function set_updated_at();

-- Row Level Security: on, with no policies = the public API sees nothing.
alter table advocates       enable row level security;
alter table clients         enable row level security;
alter table cases           enable row level security;
alter table case_notes      enable row level security;
alter table hearings        enable row level security;
alter table notifications   enable row level security;
alter table documents       enable row level security;
alter table analyses        enable row level security;
alter table drafts          enable row level security;
alter table draft_versions  enable row level security;
alter table conversations   enable row level security;
alter table messages        enable row level security;
alter table ai_usage        enable row level security;

-- Supabase-only parts (skipped on plain Postgres): lock the API roles out and
-- create the private bucket for uploaded PDFs.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on all tables in schema public from anon;
    revoke all on all sequences in schema public from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on all tables in schema public from authenticated;
    revoke all on all sequences in schema public from authenticated;
  end if;
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('case-documents', 'case-documents', false, 26214400, array['application/pdf'])
    on conflict (id) do nothing;
  end if;
end $$;
