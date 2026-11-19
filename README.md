# Advocate AI India

An AI platform for advocates practising in India, built with Next.js 16, TypeScript, Tailwind CSS 4, Supabase (Postgres + Storage), Claude, and Vercel. Sign-in is handled by **Deluxe Main**; this site has no login system of its own.

| Area | What it does |
|---|---|
| Legal chat | Streaming Q&A on Indian law, optionally using a case as context |
| Research | Structured memo; authorities are labelled *from your materials* or *AI memory: verify* |
| Drafting | Notices, petitions, affidavits, agreements; `[●]` placeholders instead of invented facts; AI edits with full version history |
| Documents | PDF upload (to private storage), text extraction, summaries; scanned PDFs are read as page images |
| Contract & judgment analysis | Risks, obligations, ratio/obiter, cited cases; every quote is checked against the document text |
| Translation | English and 12 Indian languages, with glossary and "not certified" warning |
| Cases, clients, notes | Linked records per advocate |
| Hearing calendar | Month view, reminders (in-app), `.ics` export for phone calendars |
| Dashboard, profile | Bar Council details, practice areas, courts, languages |

## "Never invent legal authorities": how that is enforced

Prompts alone cannot guarantee this, so there are three layers:

1. **Prompts** (`src/lib/ai/prompts.ts`) forbid fabricating cases, citations, quotes, sections or judges, forbid giving reporter citations from memory, and require placeholders for unknown facts.
2. **Citation guard** (`src/lib/legal/citation-guard.ts`) scans every output for reporter citations (AIR, SCC, SCR, SCC OnLine, Cri LJ, ILR, neutral citations, case numbers), `X v. Y` case names, and Act names. Anything not found in material *you* supplied is flagged, and in chat/research it is tagged `⚠️[unverified]` inline. Act names are checked against a vetted list of major central Acts (`known-acts.ts`).
3. **Source verification** (`src/lib/ai/postprocess.ts`): quotes and "cases cited in the judgment" must literally appear in the document text, otherwise they are marked *NOT found*. An authority claimed as "from your materials" that is not in them is downgraded to "AI memory".

The system cannot confirm that a case *exists*. It only guarantees that nothing the AI recalled from memory is presented as checked. Always verify on an official or licensed source (Supreme Court / High Court sites, eCourts, India Code, SCC Online, Manupatra).

## Sign-in with Deluxe Main

Implemented against Deluxe Main's real protocol (`worker/core.js`): redirect to `/connect?return=…&app=advocate` → one-use `#deluxe_code` → server-side `POST /api/connect/exchange` (sent with this site's `Origin`) → `GET /api/auth/me` re-checked every 15 minutes. A random `state` binds the code to the browser that started sign-in. The session is an encrypted, httpOnly cookie; the Deluxe key never reaches page JavaScript.

All of it lives in `src/lib/auth/provider.ts`, with the Deluxe base URL, app id and endpoint paths configurable (`DELUXE_*` variables), so an API change touches one file.

**One-time step on the Deluxe side.** Deluxe Main only signs in origins it knows. The `advocate` app is registered in the `Deluxe-Main` repo (branch `claude/advocate-ai-india-d6r3qz`, `worker/apps.js`). After deploying this site, add its exact address on the Deluxe Main server (Cloudflare Worker variable, then sync/deploy as that repo describes):

```
APP_ORIGINS={"advocate": ["https://YOUR-SITE.vercel.app"]}
```

Never use a wildcard for `vercel.app` names.

## Setup

```bash
npm install
cp .env.example .env.local      # fill in the values
npm run check                   # typecheck + tests
npm run dev
```

### Supabase
1. Create a project (region `ap-south-1` Mumbai is a good fit for Indian data).
2. Apply `supabase/migrations/0001_init.sql` (SQL editor, or `supabase db push`). It creates the tables, Row Level Security with no policies (the public API sees nothing), and a private `case-documents` bucket.
3. Set `DATABASE_URL` (Transaction pooler, port 6543), `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`. These are server-only: never prefix them with `NEXT_PUBLIC_`.

### Vercel
1. Import the repo. Set every variable from `.env.example` (at least: `APP_URL`, `SESSION_SECRET`, `DELUXE_MAIN_URL`, `DATABASE_URL`, `SUPABASE_*`, `ANTHROPIC_API_KEY`, `CRON_SECRET`).
2. `vercel.json` pins functions to Mumbai (`bom1`) and schedules the reminder job daily at 00:30 UTC (06:00 IST). Vercel's Hobby plan allows daily cron only. For finer reminder timing use a Pro plan, set a more frequent schedule, and set `REMINDER_CRON_INTERVAL_MINUTES` to match.
3. AI routes set `maxDuration = 300`; check your plan's function limit.

### Before and after deploying
```bash
node --env-file=.env.local scripts/check-env.mjs     # before: reports missing/unsafe variables (never prints values)
npm run smoke -- https://YOUR-SITE.vercel.app        # after: 20 black-box checks (sign-in gate, headers, config)
```
Deployment checklist: (1) apply the Supabase migration, (2) set the environment variables in Vercel, (3) deploy, (4) add the deployed address to Deluxe Main's `APP_ORIGINS`, (5) run the smoke test, (6) sign in once and try a chat message and a PDF upload, which exercise the live Claude and Storage paths that could not be tested in development.

### Local development without any accounts
```
AI_PROVIDER=mock  DATABASE_DRIVER=pglite  STORAGE_DRIVER=local  AUTH_PROVIDER=dev
```
Canned AI answers, an embedded Postgres in `.local-data/`, files on disk, and a stand-in sign-in. All four refuse to run in production.

## Tests

- `npm test`: 46 tests: migration, auth (including a run against Deluxe Main's real server code when `../Deluxe-Main` is checked out), tenant isolation, CSRF, reminders, PDF extraction, every AI route with a mock model, and the citation guard.
- `npm run e2e`: Playwright, real Deluxe Main sign-in through the browser, then every feature, mobile layout, and sign-out (needs `playwright`).

## What has NOT been tested live

- **Real Claude calls.** No API key was available while building. The request shapes follow the current SDK docs and compile, but the first live run with `ANTHROPIC_API_KEY` is the real test. Model defaults to `claude-opus-5-5` (`ANTHROPIC_MODEL`).
- **Supabase Storage uploads.** The browser PUTs the PDF to a signed upload URL. The local-disk equivalent is tested; the Supabase wire format should be confirmed once on a real project.
- **Live Deluxe Main on Vercel/Cloudflare**, which needs the `APP_ORIGINS` step above.

## Security and privacy notes

- Every query is scoped by advocate id; cross-references (a hearing's case, a case's client) are ownership-checked. Tested with two advocates.
- CSRF: same-origin check on every write, plus `SameSite=Lax` cookies. Security headers and a CSP are set in `next.config.ts`. API responses are `no-store`.
- Uploads are validated by content (`%PDF-`), size, and stored under `advocateId/documentId.pdf`.
- Case text and documents you analyse are sent to Anthropic's API. Confirm that fits your confidentiality and data-protection obligations (including the DPDP Act, 2023) before using client material.
- AI daily limit per advocate (`AI_DAILY_LIMIT`) is counted in the database.

AI output is not legal advice and may be wrong or out of date.
