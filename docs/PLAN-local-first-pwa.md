# Redesign plan: Advocate AI India as a local-first PWA

**Status: proposal. Nothing in this plan is implemented, deployed or applied.** It waits for approval.
Branch: `claude/local-first-plan` (this file only). Related paused work: `claude/supabase-auth` (Supabase Auth groundwork, commit `d85a21b`, does not build yet).

## 1. What you asked for

1. Installable web app (PWA), not a native app.
2. All user-generated data on the device (IndexedDB plus local file storage).
3. No Supabase Postgres storage for cases, clients, notes, drafts or conversations.
4. No Supabase Storage uploads.
5. No cloud backup or synchronisation.
6. Offline access to locally stored data.
7. Ask the browser for persistent storage where supported.
8. iPhone "Add to Home Screen" instructions.
9. Manual encrypted export and import.
10. An accurate, mandatory data-loss warning during registration (your wording), also kept under Settings → Data & Privacy.
11. Own login (Supabase Auth, email and password), independent of Deluxe Main.
12. Keep secrets and authentication secure; do not claim browser storage can never be evicted; do not deploy or touch production data.

## 2. Audit of the current system (what is server-side today)

The app today is a normal server-backed website: 38 API routes, 13 Postgres tables, a private storage bucket, server-side OCR and a cron job. Nothing is stored on the device.

| Area | How it works today | Where it goes |
|---|---|---|
| Records: profile, clients, cases, case notes, hearings, notifications, documents (metadata), analyses, drafts, draft versions, conversations, messages | 13 Postgres tables behind 4 repository files (about 450 lines) | **IndexedDB on the phone.** Production has 0 rows in both Supabase projects, so there is nothing to migrate. |
| Uploaded PDFs | Browser uploads to a private Supabase Storage bucket; server reads them | **PDF blobs in IndexedDB.** No upload to Supabase. |
| PDF text extraction | `unpdf` on the server | **In the browser** (same library, runs in a Web Worker). |
| OCR of scanned PDFs | Tesseract plus canvas on the server, resumable in batches | **In the browser** (Tesseract WebAssembly, English plus Hindi, about 17 MB of language data, cached for offline). Slower on phones; progress is saved per page. |
| Hearing reminders | Daily server cron plus a notifications table | **Local.** In-app notices, plus a calendar (`.ics`) export. See the iPhone limit in section 9. |
| AI (chat, research, analysis, drafting, translation) | 7 routes read the case, document text and chat history from the database and save the results | **Stateless server routes.** The phone sends only what you ask about; the server forwards it to Ollama Cloud, applies the citation safeguards, and returns the answer without saving it. |
| Citation safeguards (`citation-guard`, `postprocess`) | Pure TypeScript on the server | Unchanged. They run on the server for every AI answer. The quote check uses document text the phone sends. |
| Daily AI usage limits | Counted in the `ai_usage` table | **Decision needed** (section 14, item 2). |
| Sign-in | Deluxe Main (being replaced) | **Supabase Auth**, email and password, through this site's own routes. Identity and AI access only; it holds no user content. |
| Dashboard, calendar, `.ics` export | Server queries | Local queries; `.ics` built on the device (`src/lib/ics.ts` already exists). |

Client side: about 13 pages and components call the server API and must be rewired to local data (cases, clients, case detail, documents, drafting, chat, research, analysis, translate, calendar, dashboard, profile, app shell, hearing modal).

## 3. Target architecture

```
 Phone (installed PWA)                              Server (Next.js on Vercel)         External
 ┌───────────────────────────────┐   HTTPS          ┌──────────────────────────┐
 │ UI (React)                    │ ───────────────► │ /api/auth/*  (cookies)   │ ──► Supabase Auth (identity)
 │ IndexedDB: all records        │   only for:      │ /api/ai/*    (stateless) │ ──► Ollama Cloud (AI)
 │ IndexedDB: PDF blobs          │   sign-in, AI    │ /api/health              │
 │ Browser OCR + PDF text        │                  └──────────────────────────┘
 │ Service worker (offline)      │   nothing else is sent or stored off the device
 │ Web Crypto (export, lock)     │
 └───────────────────────────────┘
```

### 3.1 Local data layer
- **Library:** Dexie 4 (IndexedDB wrapper) with versioned schema upgrades; `fake-indexeddb` for tests.
- **One database per signed-in user:** `advocate:<supabase-user-id>`. Signing out never deletes data. Another account on the same phone gets a separate, empty database.
- **Stores** mirror today's tables (without the server-only `advocate_id` filtering): `profile`, `clients`, `cases`, `caseNotes`, `hearings`, `notifications`, `documents`, `documentFiles` (blobs), `analyses`, `drafts`, `draftVersions`, `conversations`, `messages`, plus a `meta` store (schema version, last export date, acceptance record).
- **IDs** are UUIDs made on the device (`crypto.randomUUID`), the same format as today, so the existing page code and validation largely carry over.
- **Repository functions keep today's names and shapes** (`createCase`, `getCaseDetail`, `listHearings`, ...), reimplemented over IndexedDB, so the UI change is mechanical.
- PDFs keep the 25 MB limit. The app shows storage used and available (`navigator.storage.estimate()`).

### 3.2 Persistence, and what we will and will not claim
- On first run the app calls `navigator.storage.persist()` and records the result. Support and behaviour differ between browsers, and a request can be denied.
- **We will not say browser storage cannot be evicted.** The honest statement shown in the app: clearing browser or website data, resetting or losing the phone, uninstalling the app, low-storage cleanup, or (for a site not added to the Home Screen) Safari's policy of removing a website's script-writable data after a long period without a visit can permanently delete local records. WebKit's policy exempts Home Screen web apps from the inactivity rule, but not from the other causes. I will verify the real behaviour on a physical iPhone before release.
- A "Data safety" panel shows: persistent storage granted or not, storage used, when you last exported, and a prompt to export.

### 3.3 Offline and PWA
- `app/manifest.ts`: name, standalone display, start URL `/dashboard`, theme colours, 192 and 512 px icons including a maskable icon (PNGs generated from the existing `icon.svg`).
- `public/sw.js`, served with the headers the Next.js PWA guide requires: precache the app shell and static assets; cache the OCR language data and WebAssembly core after first use; **never cache `/api/*`**; navigation falls back to the cached shell when offline.
- **Main technical risk:** today's pages are server-rendered per request (the layout reads cookies and redirects). Those cannot load offline. The app routes must become static client-rendered shells that read IndexedDB, with the sign-in check moved to a client gate that calls the server when online. The proxy keeps an optimistic redirect for online navigation. I will prove this with Playwright offline tests before building the rest on it.
- Content Security Policy changes: add `worker-src 'self'` and `'wasm-unsafe-eval'` for OCR; **remove** `https://*.supabase.co` from `connect-src` because the browser no longer talks to Supabase.
- **iPhone install help:** a dialog and a Data & Privacy section with steps: open the site in Safari, Share, Add to Home Screen, then open it from the icon. Android shows the install prompt.

## 4. Authentication and session (Supabase Auth, independent of Deluxe)
- Email and password only, through this site's own routes (`/api/auth/register|login|logout|forgot|reset`, `/auth/confirm`, `/auth/recovery`). The browser never holds Supabase tokens: the session is in httpOnly, Secure, SameSite=Lax cookies (the `__Host-` prefix on https).
- Uses the public anon key only, and refuses a service-role key. "Remember me" gives a persistent cookie (30 days); otherwise a session cookie.
- Password rule: at least 10 characters with a letter and a number, plus Supabase's own minimum (set to 10 or more in the dashboard).
- Password reset: token-hash links, a short-lived recovery marker, and other sessions are signed out after a reset.
- Auth pages (login, register, forgot, reset) built to the Advocate AI branding, mobile first.
- **Offline use:** a server session cannot be checked offline. Offline, the app opens from the installed shell and shows local data for the last signed-in account on the device, gated by the optional app lock (section 8). Signing in, registering and AI need a network.
- The Deluxe Main code, config and tests are removed from this app. Deluxe Main and Deluxe Drive are not modified.
- The `claude/supabase-auth` groundwork is kept for this part. Its database pieces (advocate row, `email` column, migration `0003` and the RLS policies) are dropped, since no per-user server data remains.

## 5. AI without server storage
- **New request shapes** (examples): chat `{message, history[], matterContext?}`; research `{question, materials, matterContext?}`; analysis `{kind, title, text}`; translate `{text, from, to}`; drafting `{type, details, matterContext?}`, `{content, instruction}`.
- The server checks sign-in, size limits (`AI_MAX_INPUT_CHARS`), and the usage limit, calls the provider, runs the citation guard and quote verification, and returns `{text, flags, ...}`. **It stores nothing and logs no content** (a test will assert this).
- Chat history, research memos, analyses, drafts and translations are saved by the phone in IndexedDB.
- The Ollama provider, the prompts and the safeguards stay as they are.
- **Privacy statement (needs your OK):** your wording is true for storage. AI requests, however, send the selected text to our server and on to Ollama Cloud, whose terms apply. I propose one sentence under the warning and a full section in Data & Privacy. I would not ship the warning without it, because "all your data stays on this device" would otherwise mislead people about AI requests.

## 6. PDF text and OCR in the browser
- Extract text with `unpdf` in a Web Worker.
- Scanned pages: render a page to a canvas, OCR it with Tesseract (WebAssembly, English plus Hindi), keep per-page progress in IndexedDB so an interrupted scan resumes. Language data is hosted from this site, not a third-party CDN, and cached by the service worker.
- Limits: the existing `OCR_MAX_PAGES` idea carries over (default 60); the app warns that OCR is slow and heavy on phones, and that iOS pauses background tabs, so scans run while the app is open.

## 7. Reminders (honest limits)
- A notices list built from local hearings, shown when the app opens and while it is open; optional Notification API use where available.
- **`.ics` export is the dependable path**: the phone's own calendar can alert even when this app is closed.
- On an iPhone a closed web app cannot fire reminders without a server that knows the hearing times and pushes to the phone. That would store hearing data in the cloud, so it is **out of scope**. The app will say so plainly.
- The cron route and notifications table are removed.

## 8. Security design
- **XSS matters more** when the data lives in the browser. Keep the strict CSP; AI text is rendered with `react-markdown`, which does not render raw HTML; audit for `dangerouslySetInnerHTML` and unsafe URLs; no third-party scripts.
- **Optional encryption at rest and an app lock (decision needed):**
  - *Level A:* no at-rest encryption; the device lock protects the data. Simpler.
  - *Level B (recommended):* a passphrase derives a key (PBKDF2 600,000 iterations, SHA-256). Record bodies, notes, extracted text, messages and PDF blobs are AES-GCM encrypted; only ids, dates, status and foreign keys stay plain for queries. The app locks after inactivity. A forgotten passphrase means lost data, with no recovery. I would flag this in the app.
- **Encrypted export and import:** you choose a password; PBKDF2-SHA256 (at least 600,000 iterations) derives an AES-256-GCM key; each file has its own salt and IV, a version header authenticated as additional data, and chunked encryption for large PDFs. Import decrypts and validates every record against the schema, shows counts, and offers *replace* (with explicit confirmation) or *merge* (newer `updatedAt` wins). Wrong password, truncation and tampering are all rejected. The file is saved or shared with the Web Share API where available. Nothing is uploaded. The last export date is shown and a reminder appears after 30 days or many changes.
- **Server:** only the public anon key; the service-role key is no longer needed by the app and can be removed from Vercel. Same-origin checks on state-changing routes, Supabase's own sign-in rate limits, a 503 rather than a lockout if Auth is down.

## 9. Registration warning and Settings → Data & Privacy
- **Dialog before any request:** clicking "Create account" on the register page opens an `alertdialog` with your exact title and text. The checkbox is unchecked and never pre-checked. "I Understand — Continue" is disabled until it is ticked. "Cancel" closes the dialog and sends nothing. Escape equals Cancel.
- **Recording acceptance on the device:** `localStorage` key `advocate.dataNotice` holding `{version, acceptedAt}`, mirrored into the IndexedDB `meta` store. The notice is shown again whenever its version changes.
- **No registration without acceptance:** the form cannot submit without it, and the register request carries `acceptedDataNotice: <version>`, which the server requires (400 without it). The server does not store it.
- **Readable on a phone:** 16 px or larger text, a scrollable body with sticky buttons, large tap targets, high contrast, focus trap, screen-reader labels.
- **Settings → Data & Privacy page:** the full warning, persistent-storage status and storage used, the honest eviction explanation, install instructions (iPhone and Android), export and import, an optional lock, the AI-requests-leave-the-device statement, and "Delete all local data" behind a confirmation.

## 10. What is removed or changed on the server
- No longer used by the app: Postgres access (`src/lib/db`, repositories), Supabase Storage (`src/lib/storage`), the document, OCR and cron routes, `/api/health/db`, and the env vars `DATABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_STORAGE_BUCKET`, `CRON_SECRET` (unless the usage-counter option below needs a database).
- The existing tables and bucket (migrations `0001` and `0002`) stay in Supabase, empty and untouched. Nothing is dropped without your explicit approval. Migration `0003` is not created.
- Env vars needed afterwards: `APP_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `AI_PROVIDER=ollama`, `OLLAMA_API_KEY` (+ optional `OLLAMA_MODEL`, `OLLAMA_BASE_URL`).

## 11. Phases (each ends with tests and a report; nothing deployed)
| # | Phase | Size | Notes |
|---|---|---|---|
| 0 | **Prove offline Next.js shell** (spike): static client shell, service worker, Playwright offline test | S | Settles the main technical risk first. |
| 1 | Auth identity: Supabase Auth routes, pages, proxy, remove Deluxe | M | Reuses `claude/supabase-auth`; no database. |
| 2 | Local data layer: Dexie schema, repositories, upgrade path, tests | L | Fake IndexedDB; ports the existing tests. |
| 3 | Rewire the pages to local data (cases, clients, notes, hearings, calendar, dashboard, profile) | L | Mostly mechanical. |
| 4 | Local documents: PDF store, browser text extraction and OCR | L | Real OCR test with a generated scanned PDF. |
| 5 | Stateless AI routes and local chat, research, analysis, drafting, translation | M | Test that the server stores and logs no content. |
| 6 | PWA: manifest, icons, install prompts, persistent storage request, iPhone guide | M | |
| 7 | Encrypted export and import | M | Round trip, wrong password, tamper and truncation tests. |
| 8 | Registration warning and Data & Privacy page | S | Includes the no-submit-without-acceptance tests. |
| 9 | Optional encryption at rest and app lock | M | Only if approved (decision 1). |
| 10 | Remove server persistence; docs; security review; full test run; production build | M | No deploy. |

Overall this is a rewrite of the data layer and about 13 pages, not a small change. Phases 2 to 4 are the bulk of it.

## 12. Test plan
Typecheck and production build every phase. Unit tests for repositories (fake IndexedDB), crypto and import validation. Playwright for: registration blocked until the warning is accepted, offline use after first load, reload persistence, two accounts on one device staying separate, OCR on a scanned PDF, export then import into a fresh profile, and an iPhone-size viewport (390 × 844). Assertions that the AI routes store nothing and log no content, that no Deluxe code or references remain, and that `connect-src` has no Supabase host.

## 13. Risks
| Risk | Mitigation |
|---|---|
| Browser or Safari deletes local data | `persist()`, install to Home Screen, visible export reminders, honest messaging; verify on a real iPhone. |
| App Router pages are server-rendered and fail offline | Phase 0 spike; static client shells; runtime caching. |
| OCR is slow and memory-heavy on phones | Per-page batches, saved progress, page cap, clear warnings. |
| Forgotten passphrase or export password | No recovery by design; clear warnings; export reminders. |
| Local data readable on an unlocked or compromised device | Strict CSP, optional encryption and lock. |
| AI text leaves the device | Stateless routes, no logging of content, plain disclosure, provider terms linked. |
| No second device, no recovery | Manual export and import only; the product limit is stated up front. |

## 14. Decisions needed
1. **Encryption at rest and app lock:** Level A or Level B (recommended).
2. **AI usage limits:** keep counters on the server (user id, request count and token counts, **no content**, which needs the database for counters only), or none (rely on Ollama's own limits and Supabase Auth rate limits). Recommended: counters only.
3. **Reminders:** confirm in-app notices plus `.ics` export only.
4. **Extra AI disclosure sentence** in the warning dialog (section 5).
5. **Working method:** proceed phase by phase, with a report and your approval between phases?

## 15. Not changing
No deploy, no merge to `main`, no production environment variable or database change, no deletion of existing users or records, no change to Deluxe Main or Deluxe Drive.
