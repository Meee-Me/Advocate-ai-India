# Advocate AI India

An AI platform for advocates practising in India, built with Next.js 16, TypeScript, Tailwind CSS 4, Supabase (Postgres + Storage), an AI provider (Ollama Cloud, SambaNova or Anthropic, chosen by configuration), and Vercel. Accounts are the app's own: email-and-password sign-in provided by **Supabase Auth**.

| Area | What it does |
|---|---|
| Legal chat | Streaming Q&A on Indian law, optionally using a case as context |
| Research | Structured memo; authorities are labelled *from your materials* or *AI memory: verify* |
| Drafting | Notices, petitions, affidavits, agreements; `[●]` placeholders instead of invented facts; AI edits with full version history |
| Documents | PDF upload (to private storage), text extraction, summaries; **scanned PDFs are read with OCR on the server** (no page leaves it) before any text goes to the AI |
| Contract & judgment analysis | Risks, obligations, ratio/obiter, cited cases; every quote is checked against the document text |
| Translation | English and 12 Indian languages, with glossary and "not certified" warning |
| Cases, clients, notes | Linked records per advocate |
| Hearing calendar | Month view, reminders (in-app), `.ics` export for phone calendars |
| Dashboard, profile | Bar Council details, practice areas, courts, languages |

## "Never invent legal authorities": how that is enforced

Prompts alone cannot guarantee this, so there are three layers:

1. **Prompts** (`src/lib/ai/prompts.ts`) forbid fabricating cases, citations, quotes, sections or judges, forbid giving reporter citations from memory, and require placeholders for unknown facts.
2. **Citation guard** (`src/lib/legal/citation-guard.ts`) scans every output for reporter citations (AIR, SCC, SCR, SCC OnLine, Cri LJ, ILR, neutral citations, case numbers), `X v. Y` case names, and Act names. Anything not found in material *you* supplied is flagged. **Strict by default (`CITATION_MODE=redact`): unverified reporter citations are removed** from chat answers (even while they stream, because text is released one checked line at a time), research memos and drafts, and replaced by `[citation withheld…]` / `[CITATION TO BE VERIFIED]`; case names and Acts are tagged `⚠️[unverified]`. Act names are checked against a vetted list of major central Acts (`known-acts.ts`).
3. **Source verification** (`src/lib/ai/postprocess.ts`): quotes and "cases cited in the judgment" must literally appear in the document text, otherwise they are marked *NOT found*. An authority claimed as "from your materials" that is not in them is downgraded to "AI memory".

The system cannot confirm that a case *exists*. It only guarantees that nothing the AI recalled from memory is presented as checked. Always verify on an official or licensed source (Supreme Court / High Court sites, eCourts, India Code, SCC Online, Manupatra).

## Sign-in (Supabase Auth, username + password)

The app has its own accounts. Supabase Auth is used for identity only, and the browser never talks to it: sign-up, sign-in and sign-out go through this site's own `/api/auth/*` routes (code in `src/lib/auth/`).

- **Username, not email.** Supabase Auth needs an email, so a username (starts with `@`, 5 to 100 characters in all, then letters, numbers, `.`, `-`, `_`; capitals ignored) is stored as a hashed address ending `@users.advocate-ai.invalid`, an address nobody can receive mail at. No email is ever sent.
- **Sign-up** needs a name, username and a password of at least 10 characters (a letter and a number), and a ticked acknowledgement. The person is signed in at once. **This requires "Confirm email" to be switched OFF in Supabase** (Authentication, Sign In / Providers) and the Email provider enabled.
- **No password reset.** There is no email to send a link to, so a lost password needs the administrator (reset it in the Supabase dashboard). Adding recovery later means collecting a real email.
- **Sign-in** has "keep me signed in" (30 days; otherwise until the browser closes) and sign-out.
- **Sessions** live in httpOnly, SameSite=Lax cookies (`__Host-` prefixed on https). Every API call re-checks the session with Supabase (`getUser`), so a signed-out or revoked session stops working immediately.
- Only the public anon key is used for sign-in (`SUPABASE_ANON_KEY`); a service-role key is refused there. Migration `0003_supabase_auth.sql` makes `advocates.id` the Supabase user id.

**Dashboard settings to check** (Supabase, Authentication): Email provider enabled, Confirm email off, minimum password length 10.

**Data note:** client, case, note, chat, draft and extracted-document data is stored in Postgres on the server without extra encryption by the app, so do not use real client information until the launch checks are done.

## Setup

```bash
npm install
cp .env.example .env.local      # fill in the values
npm run check                   # typecheck + tests
npm run dev
```

### Supabase
1. Create a project (region `ap-south-1` Mumbai is a good fit for Indian data).
2. Apply `supabase/migrations/0001_init.sql`, `0002_ocr.sql` and `0003_supabase_auth.sql` in order (SQL editor, or `supabase db push`). It creates the tables, Row Level Security with no policies (the public API sees nothing), and a private `case-documents` bucket.
3. Set `DATABASE_URL` (Transaction pooler, port 6543), `SUPABASE_URL`, `SUPABASE_ANON_KEY` (the public key, used for sign-in) and `SUPABASE_SERVICE_ROLE_KEY` (storage only; never give it to the sign-in code). These are server-only: never prefix them with `NEXT_PUBLIC_`.
4. Configure Authentication as described under *Sign-in* above.

### Vercel
1. Import the repo. Set every variable from `.env.example` (at least: `APP_URL`, `DATABASE_URL`, `SUPABASE_*` (including `SUPABASE_ANON_KEY`), `AI_PROVIDER` plus that provider's key (`OLLAMA_API_KEY`, `SAMBANOVA_API_KEY` or `ANTHROPIC_API_KEY`), `CRON_SECRET`).
2. `vercel.json` pins functions to Mumbai (`bom1`) and schedules the reminder job daily at 00:30 UTC (06:00 IST). Vercel's Hobby plan allows daily cron only. For finer reminder timing use a Pro plan, set a more frequent schedule, and set `REMINDER_CRON_INTERVAL_MINUTES` to match.
3. AI routes set `maxDuration = 300`; check your plan's function limit.

### AI provider: Ollama Cloud, SambaNova, Groq or Anthropic (configurable)
**Optional Groq backup:** set `AI_BACKUP_PROVIDER=groq` and `GROQ_API_KEY` (secret). If the main vendor cannot answer at all (key rejected, plan upgrade needed, limit reached, down, timed out) and has sent no text yet, the same request goes to Groq. A too-long or malformed request is never retried there. The AI consent box names both vendors, so people know where their text may go. `GROQ_MODEL` defaults to `openai/gpt-oss-120b`; Groq's free tier has small per-minute token limits, so long documents may be refused.

`AI_PROVIDER=ollama` sends every AI feature to Ollama Cloud's OpenAI-compatible API (`OLLAMA_BASE_URL`, default `https://ollama.com/v1`) with model `OLLAMA_MODEL` (default `gpt-oss:120b`), using the key in `OLLAMA_API_KEY` (a secret: set it only in Vercel, tick **Sensitive**). Differences from SambaNova: Ollama's usage limits belong to your account and are enforced by Ollama, so this site counts no request pacing (a limit shows as a friendly "usage limit reached" message); no JSON schema is sent, so structured answers (research, analysis) depend on the prompt and the validate-and-repair step; the default input ceiling is 300k characters (`AI_MAX_INPUT_CHARS`) to stay inside gpt-oss's 131k-token context. **Not yet tested live**: see *What has NOT been tested live*.

#### SambaNova
`AI_PROVIDER=sambanova` (the default) sends every AI feature (chat, research, drafting, analysis, translation) to SambaNova Cloud's OpenAI-compatible API with model `gpt-oss-120b`. Switch vendors by changing configuration; there is **no automatic fallback** between vendors, so a failure is reported, never hidden. `anthropic` (Claude) and `mock` (tests) are also selectable; adding a vendor means one file in `src/lib/ai/providers/`.

| Variable | Purpose |
|---|---|
| `AI_PROVIDER` | `sambanova` (default), `ollama`, `anthropic`, or `mock` (never in production) |
| `OLLAMA_API_KEY` | **Secret.** Only used when `AI_PROVIDER=ollama` |
| `OLLAMA_MODEL`, `OLLAMA_BASE_URL` | defaults `gpt-oss:120b`, `https://ollama.com/v1` |
| `OLLAMA_MAX_OUTPUT_TOKENS`, `OLLAMA_TIMEOUT_MS` | defaults 12000, 270000 |
| `SAMBANOVA_API_KEY` | **Secret.** Create it at cloud.sambanova.ai. Set it only in Vercel (see below) |
| `SAMBANOVA_MODEL` | default `gpt-oss-120b` |
| `SAMBANOVA_BASE_URL` | default `https://api.sambanova.ai/v1` |
| `SAMBANOVA_MAX_OUTPUT_TOKENS` | default 12000 |
| `SAMBANOVA_REASONING_EFFORT` | optional `low`/`medium`/`high` (gpt-oss only; left unset by default) |
| `AI_MAX_INPUT_CHARS` | default 150000 (about 40k tokens), so one request cannot use the whole day's allowance |
| `AI_LIMIT_RPM`, `AI_LIMIT_RPD`, `AI_LIMIT_TPD` | the plan's limits, defaulting to the **free tier: 20 per minute, 20 per day, 200,000 tokens per day**. They belong to the API key, so they are counted across everyone on the site and the site says "limit reached, resets in 3 h" up front. After moving to a paid plan raise them (or set `0` to switch a check off) |
| `AI_DAILY_LIMIT` | per-advocate requests per 24 hours (default 300) |
| `CITATION_MODE` | `redact` (default, strict) or `tag` |
| `OCR_LANGUAGES`, `OCR_MAX_PAGES` | OCR languages (default `eng+hin`) and page cap per document (default 60) |

**Free-tier reality:** 20 requests a day for the whole site is enough to try the product, not to run a practice. Each research or analysis request can use two requests (one repair retry if the AI returns malformed JSON). A paid plan removes this limit.

**Scanned PDFs** have no text, and SambaNova's production models cannot read PDFs or images, so the server reads scans itself: pages are drawn to images and read by Tesseract (WebAssembly, on the server). Progress is saved after every batch of pages, so an interrupted scan resumes. OCR can misread words; the app says so, and quote checks run against the OCR text. Mixed PDFs (some pages text, some scans) are treated by their average text per page.

**Putting the key in Vercel safely:** Project → Settings → Environment Variables → Add `SAMBANOVA_API_KEY`, paste the key, tick **Sensitive**, choose Production (and Preview if wanted), Save, then Redeploy. Never put it in code, `.env.example`, a chat, or a variable starting with `NEXT_PUBLIC_`. From a terminal: `vercel env add SAMBANOVA_API_KEY production` (it asks for the value without echoing it).

**Proving the real AI works** (do both, in this order):
1. On your computer: `AI_PROVIDER=ollama OLLAMA_API_KEY=... node scripts/ai-smoke.mjs` (3-4 requests; for SambaNova use `AI_PROVIDER=sambanova SAMBANOVA_API_KEY=...`, plus `LIVE_AI=1 npx vitest run tests/live-sambanova.test.ts`).
2. On the deployed site: sign in → Profile → **Test AI connection**. It shows the provider and model that answered, and says plainly if it is only the mock.

### Before and after deploying
```bash
node --env-file=.env.local scripts/check-env.mjs     # before: reports missing/unsafe variables (never prints values)
npm run smoke -- https://YOUR-SITE.vercel.app        # after: 27 black-box checks (sign-in gate, sign-up acknowledgement, headers, config)
```
Deployment checklist: (1) apply the Supabase migration, (2) set the environment variables in Vercel, (3) deploy, (4) set the Supabase Auth Site URL and redirect URL to the deployed address, (5) run the smoke test, (6) sign up with a throwaway email, confirm it, sign in, then try a chat message (answer the consent box) and a PDF upload, which exercise the live AI and Storage paths that could not be tested in development.

### Local development without paid services
```
AI_PROVIDER=mock  DATABASE_DRIVER=pglite  STORAGE_DRIVER=local
```
Canned AI answers, an embedded Postgres in `.local-data/`, and files on disk. All three refuse to run in production. There is no stand-in sign-in any more: point `SUPABASE_URL` and `SUPABASE_ANON_KEY` at a Supabase project (a free one works) or a local one (`supabase start`) to sign in. The tests and `npm run e2e` use fakes instead of real Supabase Auth.

## Tests

- `npm test`: unit and integration tests: migrations (incl. failed-migration rollback), auth (sign-up acknowledgement, confirmation, sign-in, reset, CSRF) against an in-memory fake of Supabase Auth, AI consent enforcement on every AI route, tenant isolation, CSRF, reminders, PDF extraction, **real OCR of a generated image-only PDF**, every AI route, the **SambaNova and Ollama providers against mocked HTTP** (streaming, JSON repair, 429/401/400/404/5xx handling, free-tier pacing), and the citation guard.
- `npm run e2e`: Playwright against the running app with a small stand-in for Supabase Auth started by the script: sign-up (acknowledgement and storage notice), email confirmation, sign-in, then every feature (answering the AI consent box each time), mobile layout, and sign-out (needs `playwright`).

## What has NOT been tested live

- **Ollama Cloud.** The provider is tested only against mocked HTTP. No real Ollama answer has been seen: run `scripts/ai-smoke.mjs` with your key and then the Profile page's **Test AI connection** before relying on it.
- **Real AI answers (SambaNova).** No SambaNova key was available while building, so no real AI answer has been seen. Verified live without a key: the API is reachable and a wrong key produces the friendly error (`tests/live-sambanova.test.ts`). Run the two proof steps under *AI provider* above with your key before relying on it. Expect weaker legal reasoning and weaker Indian-language translation than frontier models; the safeguards are there for that reason.
- **Supabase Storage uploads.** The browser PUTs the PDF to a signed upload URL. The local-disk equivalent is tested; the Supabase wire format should be confirmed once on a real project.
- **Real Supabase Auth.** Sign-up, confirmation-email delivery, sign-in, password reset and cookie behaviour on the deployed site are tested only against a fake (unit tests) and a local stand-in (e2e). Try them once on the real project with a throwaway account.

## Security and privacy notes

- Every query is scoped by advocate id; cross-references (a hearing's case, a case's client) are ownership-checked. Tested with two advocates.
- CSRF: same-origin check on every write, plus `SameSite=Lax` cookies. Security headers and a CSP are set in `next.config.ts`. API responses are `no-store`.
- Uploads are validated by content (`%PDF-`), size, and stored under `advocateId/documentId.pdf`.
- Case text and documents you analyse are sent to the selected AI provider's API (Ollama Cloud, SambaNova or Anthropic; OCR itself runs on this server). Read that provider's data-use terms for the plan you use; free plans may differ. Confirm that fits your confidentiality and data-protection obligations (including the DPDP Act, 2023) before using client material.
- AI daily limit per advocate (`AI_DAILY_LIMIT`) is counted in the database.

AI output is not legal advice and may be wrong or out of date.
