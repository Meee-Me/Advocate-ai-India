# Advocate AI India: final architecture handover (design only)

**Status: design with approved decisions recorded in the Decision record below. Nothing here is implemented, pushed, merged or deployed. Phase 0 and every phase in this document are NOT approved to start.**
It supersedes the earlier `docs/PLAN-local-first-pwa.md` (commit `cb5baf8`) where they differ.

> **USER IDENTITY IS CENTRAL. PRIVATE LEGAL DATA IS DEVICE-OWNED.**

Contents: 0 Reconciliation findings · 1 Repository change map · 2 Authentication design · 3 Local encryption and key management · 4 IndexedDB schema · 5 AI data flows · 6 Threat model · 7 Phase-by-phase test plan · 8 Retain / retire list · 9 Decisions and assumptions · Sources.

## Decision record (recorded 2026-11-22)

**Approved by you** (all eight recommendations, with 4(c)):

| # | Decision | Status |
|---|---|---|
| 1 | No multi-device sync and no server-driven reminders in version 1. | Approved |
| 2 | Android: the latest two Chrome versions and Samsung Internet. iPhone: a vault is created only in an installed Home Screen app. | Approved. The iPhone rule is **provisional** until real-device testing (U1). |
| 3 | Vault passphrase of at least 12 characters or four random words, separate from the account password. A recovery phrase/code only after the encryption review; it cannot restore data without a surviving backup. | Approved. Recovery is **deferred**. |
| 4 | Manual encrypted **file** backup only, per D10: a separate backup key derived from the vault passphrase with its own salt; no separate export password in version 1. | Approved as **4(c): no cloud backup in version 1**. |
| 5 | Consent before every cloud AI request (an existing requirement); minimal disclosed server-side usage counters (advocate, time, token counts, no content); no server OCR fallback in version 1; Malayalam OCR only after accuracy testing. | Approved. **Open:** where the counters are stored, and their retention (30 days was proposed; not separately confirmed). |
| 6 | The current server mode stays only for synthetic-data testing, behind a visible warning, and is retired after the local-first work passes. | Approved |
| 7 | Warnings are finalised only after native-speaker, legal and advocate-comprehension reviews. No recovery or backup is promised until it is built and restore-tested. | Approved |
| 8 | An independent security reviewer, a real-device test matrix, and verification of the current Vercel Hobby terms from primary sources before real advocates use the app. | Approved as requirements. The reviewer and devices are **not yet chosen**; the verification is **not yet done**. |

**Parked (not in version 1):** cloud backup, a per-backup size limit, retention of the latest three cloud backups, and deletion of cloud backups with the account. Nothing in this document depends on them.

**Unchanged requirements:** installable local-first PWA for individual advocates in India (Malayalam first, English supported); AES-256-GCM with an Argon2id-derived key; Supabase Auth for identity only; cloud AI only with consent before every request, no content stored server-side, and no silent fallback from private to cloud; reminders while the app is open plus calendar export; D10 backups with verification, dry-run imports, no silent overwrite, and 7-day and 30-day reminders; accounts unrecoverable by default; free hosting only.

**Gate:** no real client data until backup and restore testing and the independent security review pass. Until then, synthetic data only.

**Not approved to start:** Phase 0 (the approved plan's offline-shell spike plus real-device storage tests, which comes before this document's Phase 1) and every phase below. Each needs a separate go-ahead.

**Unresolved facts, not to be treated as facts:** U1 browser storage persistence and eviction, including whether installed iPhone apps keep their data; U2 Samsung Internet behaviour; U3 Vercel Hobby terms (the definition of commercial use and any AI-training clause); U4 Malayalam OCR accuracy.

**Sections changed by this record** (each carries a short note): 1.2, 1.3, 3.2, 3.6, 3.9, 5.6, 6 (T11, T13 and the asset list), Phase 8 tests, 8.3, 8.4 and 9.


---

## 0. Reconciliation: what the source actually shows

### 0.1 Branches inspected

| Branch | Head | What it is | Verdict |
|---|---|---|---|
| `main` (= `origin/main`) | `5635de9` | Server-backed app: Deluxe Main sign-in, Postgres via Drizzle, Supabase Storage, server OCR, cron reminders, Ollama provider. Deployed. | Stays as the production version until the final, approved cutover. |
| `claude/supabase-auth` | `d85a21b` | 12 files, +439/−88: server-side Supabase client, guard, validation, config, diagnostics, an `ensureAdvocate` DB shim, migration `0003`. | **Groundwork only; not trusted.** See 0.2. |
| `claude/local-first-plan` | `cb5baf8` | Earlier plan document (1 file). | Superseded by this document; kept as history. |
| `claude/signin-db-diagnostics` | `fb24159` | Safe DB-failure logging for the **Deluxe** callback. | Discard: it fixes a flow that is being removed. |
| `claude/ollama-provider`, `claude/region-hnd1`, `claude/advocate-ai-india-d6r3qz` | merged into `main` | History. | None. |

### 0.2 `d85a21b` reviewed rather than assumed correct

Checked by reading the code and the installed library sources. **None of it has been run:** there are no tests for it, no real Supabase Auth server was ever contacted, and I have no anon key for the project.

- `tsc` reports 13 errors. All are leftovers from files not yet deleted (`provider.ts`, `routes.ts`, `session.ts`, and the Deluxe tests). None is in the new files.
- Verified in library source: `@supabase/ssr` honours `cookieOptions.name` as the storage key; auth-js refreshes an expired access token inside `getUser()`; zod 4's `{ error: ... }` message form is valid.
- **Sound ideas to keep:** refuse a service-role key in the anon-key slot; httpOnly, Secure, SameSite=Lax cookies with the `__Host-` prefix on https; per-request client; `getUser()` on every API request so a signed-out session stops working immediately; shared zod validation; cookies carried on error responses.
- **To discard:** `ensureAdvocate`, the `advocates.email` column, migration `0003` and its RLS policies, and the `http.ts` coupling to a database. They exist only to keep a central per-user database, which this direction removes.
- **Open defects or unknowns to settle in Phase 1:** error-code mapping for real GoTrue responses (duplicate sign-up, unconfirmed email, rate limits) is untested; the recovery-marker cookie flow is untested; cookie size and chunking with the real session are untested; there is no CSRF consideration for the confirm and recovery GET routes beyond the fixed redirect targets.

### 0.3 Corrections to the earlier plan (`cb5baf8`), from the real code

| Earlier claim | Reality in the source | Correction |
|---|---|---|
| "38 API routes" | 39 `route.ts` files | 39. |
| OCR data "about 17 MB" | Used variants: English about 3 MB (`4.0.0_best_int`) or about 11 MB (`4.0.0`), Hindi about 1.4 MB, plus a WebAssembly core of about 3.9 MB | Offline cache is roughly 8–17 MB depending on the model variant chosen. |
| "`unpdf` runs in the browser" | `unpdf` exports a `toDataURL` rendering path meant for non-Node canvases, and `tesseract.js` ships browser worker files. The repo's `ocr.ts` is Node-only (`node:fs`, `@napi-rs/canvas`) | Plausible, **not yet proven**. Phase 4 starts with a spike. |
| Pure code can be reused | Verified: `citation-guard`, `known-acts`, `draft-types`, `postprocess`, `prompts`, `schemas`, `ics`, `validation`, `providers/ollama` have **no Node or database imports** | They carry over. `context.ts` (DB-bound), `ocr.ts`, repos, storage, `ai/client.ts` (reads server config) must be rewritten or split. |
| PBKDF2 for keys | Current OWASP guidance (as summarised by several sources) prefers Argon2id (minimum 19 MiB, t=2, p=1); PBKDF2-HMAC-SHA256 needs 600,000+ iterations | **Argon2id** (WebAssembly) with PBKDF2 as a fallback. |
| Server AI usage counters in a database | You ruled out a central database | Default: none (see 5.6). |
| Tests "port over" | Only pure-module tests do (`citation-guard` 12, `providers` 53). `practice`, `ai`, `migration`, `health-db`, `auth` (Deluxe) and `ocr` tests are tied to the server stack | Rewritten per phase (section 7). |
| Persistence claims | See 3.9: WebKit heuristics decide `persist()`; Home Screen apps share Safari's quota; the 7-day inactivity rule is reported as applying to Safari, not Home Screen apps, but this is **not firmly documented** | Hedged wording; verify on a real iPhone. |
| New requirement: on-device AI | Not in the earlier plan | Feasibility in 5.4: possible on recent phones with small models, with real limits. |

---

## 1. Final repository change map

### 1.1 Target layout (new or changed areas)

```
src/
  app/
    (public)/login, register, forgot-password, reset-password, verify-email    [Phase 1, new]
    auth/confirm, auth/recovery                                               [Phase 1, new route handlers]
    api/auth/{register,login,logout,forgot,reset,resend,session}              [Phase 1, new]
    api/ai/{chat,research,analysis,translate,draft,draft-edit}                [Phase 5, new stateless]
    api/health                                                                [kept, simplified]
    (app)/…  vault/unlock, vault/create, cases, clients, documents, drafting,
             chat, research, analysis, translate, calendar, dashboard,
             profile, settings/data-privacy                                   [Phases 2–8, rewritten as client shells]
    manifest.ts, offline page                                                 [Phase 7, new]
  lib/
    auth/        supabase.ts, guard.ts, validation.ts, cookies               [Phase 1, from d85a21b, reviewed]
    vault/       crypto.ts, keys.ts, vault.ts, lock.ts                        [Phase 2, new]
    local/       db.ts (Dexie), schema.ts, repos/*, search.ts                 [Phases 2–3, new]
    pdf/         extract.ts (kept), ocr-browser.ts, worker                    [Phase 4]
    ai/          prompts, schemas, postprocess, providers/ollama (kept);
                 local-engine/*, cloud-client.ts, consent.ts, structured.ts   [Phase 5]
    reminders/   local scheduler, ics (kept)                                  [Phase 6]
    pwa/         register-sw, install, persist, storage-estimate              [Phase 7]
    backup/      export.ts, import.ts, format.ts                              [Phase 8]
  proxy.ts       optimistic page redirect only                                [Phase 1]
public/sw.js     service worker                                               [Phase 7]
docs/            this file; threat model; test plan                           [now]
```

### 1.2 Server surface after the redesign
Only: `/api/auth/*`, `/auth/confirm`, `/auth/recovery`, `/api/ai/*` (stateless, signed-in only), `/api/health`. **No database, no storage, no cron.** *(Decision record 5 adds one exception: minimal usage counters with no content; the mechanism is still open.)*

### 1.3 Working method
- One integration branch (`claude/local-first-app`, from `main`) with a commit series per phase; tests green at the end of each phase; **never pushed or deployed without your approval**.
- **Phase 1 leaves the branch un-deployable by design:** it deletes the Deluxe sign-in and the database-backed routes, and the signed-in home becomes a stub until Phase 2 and 3 restore function. `main` keeps serving the current site meanwhile (production has no users and 0 rows). The alternative (a throwaway shim that keeps server data routes alive) is more code to delete later; see decision 9.5.
- *Decision record 6:* the current server mode stays for synthetic-data tests behind a visible warning and is retired after the local-first work passes, so deleting the server data routes moves from Phase 1 to that retirement step. This Phase 1 scope is to be re-confirmed before Phase 1 starts.
- **Design rule from Phase 1 onward:** app pages must be client shells that do not read cookies on the server, otherwise Phase 7's offline mode is impossible (today's server-rendered layout redirects from the server).

---

## 2. Authentication design (Supabase Auth, independent)

### 2.1 Principles
- Supabase Auth owns **identity only**: account, email verification, password, reset, sessions, unique user id.
- It has **no role in encryption or data access.** No Supabase credential, token, user id or password ever feeds a key (section 3).
- No private data is sent to or retrievable from any server by account id.
- No dependency on Deluxe Main; no redirect; no shared sessions. A repository-wide check for "deluxe" must find nothing outside `docs/` history.

### 2.2 Components
- **Browser holds no Supabase tokens.** All auth calls go through this site's routes; the session lives in httpOnly, Secure, SameSite=Lax cookies (`__Host-` prefix on https). Only the public anon key is used, on the server; a service-role key is refused at startup.
- **"Remember me":** persistent cookie (30 days) when ticked, otherwise a session cookie. A tiny `remember` marker cookie keeps refreshes consistent.
- **Per-request client + `getUser()`** in the API guard (authoritative; honours sign-out and revocation). The proxy does only an optimistic redirect for page navigations.
- **Client gate:** `GET /api/auth/session` → `{ user: {id, email, name} }` or 401. It is the only source the UI trusts online. Offline, see 2.6.

### 2.3 Flows

| Flow | Steps | Notes |
|---|---|---|
| Register | Form (name, email, password, confirm) → `POST /api/auth/register` → `signUp` with `emailRedirectTo=/auth/confirm` → "Check your email" page | "Confirm email" is **enabled**; no session until verified. Duplicate emails get a neutral message (Supabase returns an obfuscated user), which avoids account enumeration. |
| Verify email | Link → `/auth/confirm?token_hash=…&type=signup` (or `?code=` for the default PKCE template) → `verifyOtp` / `exchangeCodeForSession` → cookies set → redirect to the vault screen | Fixed redirect targets; no `next` parameter (no open redirect). |
| Resend verification | `POST /api/auth/resend` (rate-limited by Supabase) | Generic response. |
| Login | `POST /api/auth/login` (email, password, remember) → `signInWithPassword` | `invalid_credentials` → one message for wrong email or password. `email_not_confirmed` → offer resend. |
| Logout | `POST /api/auth/logout` → `signOut({scope:'local'})` + clear all auth cookies | **Never touches the vault**; the vault stays on the device, locked. |
| Forgot password | `POST /api/auth/forgot` → `resetPasswordForEmail` → always the same success message (rate-limit and mail-failure get distinct errors) | |
| Reset password | `/auth/recovery` verifies the link, sets a short-lived recovery marker cookie → `/reset-password` → `POST /api/auth/reset` (requires marker) → `updateUser` → sign out other sessions | A password change is not possible from a normal session through this route. **The reset has no effect on any vault** (2.5). |

### 2.4 Validation and UX
Password rule on the server and client: at least 10 characters, a letter and a number (set Supabase's own minimum to 10 or more too); at most 72 bytes. Show/hide password, remember me, friendly mobile-first forms with loading states, premium Advocate AI branding using the existing tokens (navy, brass, serif headings).

### 2.5 Account and vault are separate by construction
- The vault is created **on a device, locally**, with its own random key (section 3). The account id is only a **local label** that decides which local vault to show; it is not an input to any key.
- Signing in on another device finds no vault there → "Create a new vault" or "Import a backup". **Never** "restore from account".
- Resetting the account password, or recreating the account, cannot decrypt anything.
- Signing in as a different account on the same phone shows that account's own (empty or separate) vault.

### 2.6 Offline behaviour
A server session cannot be checked offline. The app records a non-secret marker `{userId, email, lastVerifiedAt}` after each successful online check. Offline, if the marker is younger than the allowed window (proposed 30 days), the app offers the vault unlock screen; **the vault passphrase is the real protection**. Registration, login, verification, reset and cloud AI need the network.

### 2.7 Supabase configuration required (dashboard; nothing changed by me)
Site URL `https://advocate-ai-india.vercel.app`; Redirect URLs allow-list: `…/auth/confirm`, `…/auth/recovery` (and `http://localhost:3000/...` for development); Email provider on; **Confirm email on**; minimum password length 10+; email templates changed to token-hash links (`{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=signup`, and `/auth/recovery?token_hash=…&type=recovery`) so links work from another device; a **custom SMTP** sender for production (the built-in sender is heavily rate-limited); rate limits reviewed; optional CAPTCHA.

### 2.8 Environment variables (names only)
`APP_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `AI_PROVIDER=ollama`, `OLLAMA_API_KEY`, optional `OLLAMA_MODEL`, `OLLAMA_BASE_URL`, `AI_MAX_INPUT_CHARS`. **No longer needed:** `DATABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_STORAGE_BUCKET`, `CRON_SECRET`, `SESSION_SECRET`, all `DELUXE_*`, and (if SambaNova and Anthropic are retired) their keys.

### 2.9 Testing note (important)
Automated tests need a stand-in auth server: a small fake GoTrue (sign-up, token, user, logout, recover, verify) so the real `@supabase/ssr` code paths run. **I cannot test against the real project's Auth without creating real users in it**, and the free plan limits active projects, so a third project is not an option. Real-Auth verification is therefore a short manual checklist you run with a test mailbox, or a local Supabase stack if Docker is available to you.

---

## 3. Local encryption and key management

### 3.1 Goals
Protect legal data at rest on the phone against casual access, other apps, file-level extraction and a borrowed unlocked phone (while locked). Backups are independent of the vault. **No server, account or Supabase credential can decrypt anything.**

### 3.2 Key hierarchy
```
Vault passphrase ──Argon2id(salt, m, t, p)──► KEK ──AES-256-GCM unwrap──► VMK  (random 256-bit, made on this device)
Recovery code (optional) ──HKDF──► KEK2 ───AES-256-GCM unwrap──► VMK
Quick-unlock key (optional, non-extractable CryptoKey) ─────────► VMK
VMK ──HKDF-SHA256(info="records")──► K_records   (AES-256-GCM)
    ──HKDF(info="files")──────────► K_files     (AES-256-GCM, chunked)
    ──HKDF(info="index")──────────► K_index     (HMAC-SHA256 blind tags)
    ──HKDF(info="meta")───────────► K_meta
```
- **VMK** is generated by `crypto.getRandomValues` at vault creation, never leaves the device, and is stored only wrapped.
- **Passphrase** is chosen at vault creation and is **separate from the account password** (the screen says so and tells people not to reuse it). It is never sent anywhere. Minimum 12 characters or four random words (approved), with a strength meter.
- **KDF:** Argon2id via a WebAssembly library (vetted in Phase 2 for licence, maintenance and CSP needs), calibrated on the device at creation to about 0.5–1 s, **never below** the OWASP minimum (19 MiB, t=2, p=1); proposed default 64 MiB, t=3, p=1. All parameters and the salt are stored with the wrapped key so they can be upgraded. If WebAssembly is unavailable, fall back to PBKDF2-HMAC-SHA256 with at least 600,000 iterations.
- **Wrapped VMK record:** `{v, kdf:{alg,m,t,p,salt}, wrap:{alg:"AES-256-GCM", iv, ct}}`. The GCM tag doubles as the "right passphrase" check.
- **Changing the passphrase** re-wraps the VMK; no data is re-encrypted.
- **Optional recovery code (DEFERRED by Decision record 3: nothing is built until after the encryption review; it can never restore data that no longer exists on the device or in a backup):** a random 160-bit code shown once to write down, stored as a second wrapped copy of the VMK. It addresses a forgotten passphrase; losing both means the vault is unrecoverable except from a backup. Decision 9.1.
- **Optional quick unlock:** a non-extractable AES-GCM `CryptoKey` kept in IndexedDB wraps a second copy of the VMK, so the passphrase is not asked on every unlock. **Off by default.** Weaker: any code running in the origin can use it. Browser data eviction removes it and falls back to the passphrase. WebAuthn PRF is a possible later upgrade, not assumed.

### 3.3 Encrypting data
- **Records:** AES-256-GCM, random 96-bit IV per record, **AAD = `vaultId | store | recordId | schemaVersion`**, so ciphertext cannot be swapped between records or vaults undetected.
- **Files (PDFs):** chunked AES-256-GCM (about 1 MiB chunks), each chunk's index and an end-of-file flag in the AAD (detects reordering and truncation), stored as ciphertext in the origin-private file system where available, otherwise in IndexedDB.
- **What stays in plaintext in IndexedDB:** the random record `id`, a store-level schema version, and **blind index tags** `HMAC-SHA256(K_index, field‖value)` (truncated) for foreign keys and status (for example, which conversation a message belongs to), so large stores load by tag without decrypting everything. Names, titles, dates, text, case numbers and file names are inside the ciphertext. Search is done in memory after unlock; the data volumes are small enough.

### 3.4 Lock and unlock
- Unlock imports the VMK as a **non-extractable `CryptoKey`** held in memory; raw key bytes are cleared best-effort (JavaScript cannot guarantee zeroisation).
- **Auto-lock** on a timer (default 5 minutes of inactivity), when the app goes to the background (`visibilitychange`, configurable), and on logout. Locking drops all keys and decrypted data from memory.
- A privacy cover hides content in the app switcher where the platform allows.
- Repeated wrong passphrases cause an escalating delay in the UI. This does not stop an attacker who copies the database; Argon2id cost and passphrase strength do.

### 3.5 What this does not protect against (stated in the app)
Malicious code running in the page while unlocked (XSS, compromised dependency), a compromised operating system, a keylogger, someone watching you type, and a weak passphrase. Client-side encryption is not a substitute for XSS protection (section 6).

### 3.6 Backup (export) crypto, separate from the vault
- **D10 (approved):** the backup key is derived from the **vault passphrase** with a **separate random salt** (Argon2id, same floors) → AES-256-GCM key. There is **no separate export password in version 1**. The file header records a non-secret passphrase label, so a backup made before a passphrase change still needs the passphrase that was in use when it was made. After every export the app decrypts and checks the file it just wrote (counts and checksums). Manual file only: **no cloud backup in version 1**.
- File: magic header + format version + KDF parameters and salt, then chunked ciphertext. Each chunk carries its index and a final-chunk flag in the AAD. A manifest (counts, app version, created time) is the first encrypted chunk, so counts cannot be forged.
- Records are exported decrypted-then-re-encrypted under the backup key, **not under the VMK**, so a backup does not depend on the vault's stored keys; it does depend on the passphrase that was in use when it was made.
- Import is explicit and never overwrites: see section 4.6.

### 3.7 Keys never derived from anything server-side
No Supabase password, token, session, user id or email enters any KDF or key wrap. A test asserts that deleting every auth cookie and the marker leaves the vault unlockable with the passphrase alone, and that a password reset changes nothing in the vault database.

### 3.8 Account re-creation and orphaned vaults
If an account is deleted and recreated (new user id), the old vault is still on the device under the old label. A "Vaults on this device" screen lists local vaults (with a masked email), lets you unlock one with its passphrase to export it, or delete it. Decision 9.2 covers whether the account must be signed in to unlock.

### 3.9 Honest persistence statement
**Provisional rule (Decision record 2):** on iPhone a vault is created only in an installed Home Screen app. This stays provisional until real-device tests settle U1.

Local data can be lost: clearing site data, resetting or losing the phone, uninstalling, low-storage cleanup, browser policy, or a forgotten passphrase. `navigator.storage.persist()` is requested and its result shown; browsers decide by their own heuristics (WebKit reportedly uses signals such as whether the site is a Home Screen web app). Home Screen web apps reportedly share Safari's quota and are exempt from Safari's inactivity-based deletion, but I could not confirm that from Apple's documentation and will test it on a physical iPhone. The app never claims data cannot be evicted. See Sources.

---

## 4. IndexedDB schema proposal

### 4.1 Databases
- `advocate-registry` (one per origin): list of local vaults `{vaultId, accountId (label), emailMasked, createdAt, lastOpenedAt}`; the non-secret session marker.
- `advocate-vault:<vaultId>` (one per vault): all private data below.
- Library: Dexie 4 with versioned upgrade functions; `fake-indexeddb` for tests. Model weights (for private AI) live in Cache Storage or OPFS, **not** in the vault database, because they are public files.

### 4.2 Stores in `advocate-vault:<vaultId>` (database version 1)
Every record is an **envelope** `{ id, v, iv, ct, tags? }` unless noted.

| Store | Plaintext fields | Encrypted payload (examples) | Maps from today's table |
|---|---|---|---|
| `vault` (single key `meta`) | `vaultId`, `createdAt`, `schemaVersion`, wrapped VMK(s), KDF parameters | settings, consent preferences, last export date, data-notice acceptance `{version, acceptedAt}`, counters | – |
| `profile` | `id` | name, enrolment number, bar council, phone, city, state, bio, practice areas, courts, languages | `advocates` |
| `clients` | `id` | name, email, phone, address, notes, timestamps | `clients` |
| `cases` | `id`, tag(`client`), tag(`status`) | title, case numbers, court, type, stage, parties, judge, filing date, description, timestamps | `cases` |
| `caseNotes` | `id`, tag(`case`) | body, timestamps | `case_notes` |
| `hearings` | `id`, tag(`case`) | date and time, purpose, court, room, status, notes, remind-before | `hearings` |
| `reminders` | `id`, tag(`hearing`) | due time, fired time, text | `notifications` + cron |
| `documents` | `id`, tag(`case`) | title, file name, size, page count, extracted text, OCR state (needs OCR, pages done, confidence) | `documents` |
| `fileChunks` | `id`=`docId:n`, tag(`doc`) | ciphertext chunk only (or the file lives in OPFS with the same envelope) | Storage bucket |
| `analyses` | `id`, tag(`doc`), tag(`case`), `kind` tag | result JSON, title, model, flags | `analyses` |
| `drafts` | `id`, tag(`case`) | title, type, language, content, timestamps | `drafts` |
| `draftVersions` | `id`, tag(`draft`) | content, note, timestamp | `draft_versions` |
| `conversations` | `id`, tag(`case`), `mode` tag | title, mode (private or cloud), timestamps | `conversations` |
| `messages` | `id`, tag(`conversation`) | role, content, flags, model, timestamp | `messages` |
| `ocrJobs` | `id`, tag(`doc`) | progress, language, confidence (resumable) | OCR columns |

`ai_usage` has **no counterpart** (no central counters; see 5.6).

### 4.3 Conventions
Client-generated UUIDs; `createdAt`/`updatedAt` live **inside** the ciphertext; integer `schemaVersion` per record for lazy migration; soft delete is not used (deletes are real); size caps (PDF 25 MB, text 1.5 M characters as today).

### 4.4 Migrations
Dexie version steps for structure; per-record upgrade functions for payload changes (decrypt, transform, re-encrypt in a transaction); a pre-upgrade prompt to export when a destructive step is needed.

### 4.5 Quotas and health
Show `navigator.storage.estimate()`, whether `persisted()`, last export date, and warn at 80% of quota. A failed write (quota or eviction) stops the operation with a clear message instead of failing silently.

### 4.6 Import rules (never overwrite)
1. **Into a new empty vault:** default when no vault exists.
2. **Add to the current vault:** adds records whose ids do not exist; for an id that exists, the existing record is kept and the incoming one is reported as a conflict (optionally imported as a copy with a new id, only if you choose).
3. **Replace** is not offered in version 1. To restore over existing data, delete the vault (confirmed) and import into a new one.
Every import first runs a dry run (decrypt, verify integrity, validate every record with zod, enforce size caps) and shows counts before anything is written.

---

## 5. AI data flows

### 5.1 Invariants (tested)
1. **Private mode never contacts the network with private content.**
2. **Cloud mode never sends anything without explicit, specific consent for that send.**
3. **No silent fallback** from Private to Cloud, ever. If the device cannot run Private mode, the feature says so and offers Cloud only as a separate, consented choice.
4. The server stores no prompt, document, response or private content, and logs none.
5. Returned cloud answers are stored locally only when the user chooses Save.

### 5.2 Private mode (on-device)
```
 [Vault, unlocked, in memory]
        │ selected case notes / document text / question (you choose what)
        ▼
 [Prompt builder: prompts.ts + matterContext (local)]
        ▼
 [On-device engine: Web Worker]  ← model weights (public files, cached) from Cache Storage / OPFS
        ▼
 [Output validation: JSON schema + repair loop (local)]
        ▼
 [Citation guard + quote check (same TypeScript, run in the browser)]
        ▼
 [Shown to you; history saved to the vault by default (toggle)]
 ── no network request carries any of the above ──
```
The weights are downloaded once, with explicit opt-in, over the network from a pinned, hash-verified source; that download carries **no user data**.

### 5.3 Cloud mode (Ollama Cloud, explicit consent)
```
 You select what to send (question + chosen case facts / document excerpt)
        ▼
 [Consent sheet]  shows the exact payload, its size, who processes it
                  (this application's server and Ollama Cloud), and the retention statement
                  → checkbox + "Send"   (default: asked every time)
        ▼  HTTPS POST /api/ai/<feature>   (signed-in cookie; body only in transit)
 [Server route]  checks sign-in + size cap → builds prompt → Ollama → output validation
                 → citation guard → returns {text, flags}   — stores and logs nothing
        ▼
 [Shown to you]  → "Save to case / notes / history" only if you press it  (encrypted, local)
```
- The server never writes the body anywhere: no database, no files, no analytics, no error reports that include it. Error paths log a code, never content. Platform request logs contain method, path and status, not bodies. A test asserts there is no log line or console output containing a unique marker sent in a request.
- **Consent wording (draft):** "To answer this, the text below will be sent over the internet to this site's server and on to Ollama Cloud, where it is processed to produce the answer. Ollama states that it does not record, log or train on prompts or responses; that is the provider's own statement and we cannot verify it. Do not send anything you are not willing to share. Nothing is saved on our side."
- Decision 9.3: ask every time, or allow "don't ask again this session" (kept in memory only, cleared on lock).

### 5.4 On-device model: feasibility and limits (honest)
- **Engine:** WebGPU-based in-browser inference (such as WebLLM) is the fast path; a WebAssembly CPU engine (llama.cpp-style) is the compatible but slow fallback. The exact engine and model are chosen **in Phase 5 after tests on real phones** (memory, speed, licence, output quality). I am not naming a model now.
- **Devices:** WebGPU shipped in Safari 26 / iOS 26, so iPhones need iOS 26 or later for the fast path. Reports describe memory-related crashes and command-buffer throttling on iOS, and older WebLLM notes mention memory limits that make iOS kill pages. Expect small models (roughly 1–4 billion parameters, 4-bit), downloads of hundreds of MB to a couple of GB, and phones that cannot run it at all.
- **Quality:** small models reason about law considerably worse than a large cloud model, handle short contexts, and follow JSON schemas less reliably. Private mode therefore gets stricter guardrails: shorter inputs, the same citation guard and quote verification, a visible "private mode: less capable, verify everything" label, and capability detection that disables the feature where the device cannot run it.
- **Plan B if testing shows it is not usable on target phones:** ship Private mode as limited tasks (summaries, translation drafts, formatting) and keep Cloud mode for the rest. You decide this at the end of Phase 5 with the measurements in hand.

### 5.5 What lives where

| Data | Device vault | App server | Supabase Auth | Ollama Cloud |
|---|---|---|---|---|
| Cases, clients, notes, drafts, documents, history, reminders | **Yes (encrypted)** | No | No | No |
| Email, password hash, session | No | Cookie only | **Yes** | No |
| Selected content for a cloud answer | Source | **In transit only** | No | **Processes it** (provider terms) |
| Model weights | Cached (public) | Not hosted by us | No | – |

### 5.6 Abuse and cost control without a central database
Cloud AI can be abused by anyone with an account. With no database allowed for private content, options: (a) rely on sign-in, per-request size caps, Supabase's auth rate limits and Ollama's own account limits (simplest); (b) a best-effort in-memory limiter (weak on serverless); (c) a small counters-only store (user id, count, time; **no content**) such as a managed key-value service. Default: (a) now, (c) only if abuse appears and you approve it. Decision 9.4. **Decision record 5 now approves minimal, disclosed counters (advocate, time, token counts, no content) instead of default (a). Open: the storage mechanism and the retention period (30 days proposed, not separately confirmed).**

---

## 6. Security threat model

### 6.1 Assets and trust boundaries
Assets: the decrypted vault in memory; the encrypted vault on the device; vault passphrase, recovery code (deferred), backup files (no separate export password in version 1); account identity (email, password); the AI request in transit; the application code and its dependencies. Boundaries: device ↔ application server ↔ Supabase Auth ↔ Ollama Cloud; and the web origin itself (the strongest local boundary is the browser's same-origin rule).

### 6.2 Threats and mitigations

| # | Threat | Mitigation | Residual risk |
|---|---|---|---|
| T1 | Lost or stolen phone, locked | Device lock; vault encrypted with Argon2id-wrapped key; auto-lock | Offline brute force against a weak passphrase if the storage is extracted. Passphrase minimum and strength meter. |
| T2 | Stolen unlocked phone, app open or quick-unlock on | Auto-lock timer and background lock; quick unlock **off by default** | Within the lock timeout, the thief has access. |
| T3 | XSS or malicious script in the origin | Strict CSP (no inline eval, same-origin scripts; `wasm-unsafe-eval` only for OCR and crypto), no raw-HTML rendering, audit for `dangerouslySetInnerHTML`, dependency vetting and lockfile, no third-party scripts or CDNs, Subresource-style hashing for self-hosted model files | While unlocked, injected code can read decrypted data. This is the largest residual risk of any local-first design. |
| T4 | Supply-chain compromise (npm package, model file) | Pin versions, `npm audit`, minimal dependencies, review crypto and WASM libraries, verify model hashes, reproducible build | Cannot be eliminated. |
| T5 | Service-worker poisoning or stale cache | SW served same-origin with no-cache header, versioned caches, never cache `/api/*`, update flow | Low. |
| T6 | Account takeover (phished password) | Email verification, strong password rule, Supabase rate limits, optional CAPTCHA, optional MFA later | Attacker can sign in elsewhere and use cloud AI, **but gets an empty vault**. The real device vault needs its own passphrase. |
| T7 | Password reset abuse | Neutral responses, token-hash links, short-lived recovery marker | A reset never decrypts a vault (tested). |
| T8 | Application server compromise | Holds no private data at rest; request bodies not logged | Attacker could read **in-flight** cloud-AI requests while controlling the server. Mitigation: cloud mode is opt-in per send; Private mode is unaffected. |
| T9 | Ollama Cloud processing | Explicit consent; plain disclosure; provider statements linked (not independently verified); jurisdiction caveat (sources mention US/Europe, and Singapore for some models) | You rely on the provider's word and law. |
| T10 | Network attacker | HTTPS only, HSTS, cookies Secure | Low. |
| T11 | Backup file stolen | Argon2id-derived AES-GCM, tamper detection, no key stored in the file | Weak vault passphrase; user education. |
| T12 | Malicious or corrupted import | Dry run, schema validation, size and count caps, no overwrite, authenticated chunks, truncation flag | Low. |
| T13 | Data loss (eviction, reset, lost device, forgotten passphrase) | `persist()`, install to Home Screen (the iPhone vault requirement is provisional pending real-device tests), visible export reminders, optional recovery code (deferred), honest warnings | **Cannot be fully prevented by design** (no cloud copy). Stated at registration and in Data & Privacy. |
| T14 | Cloud AI used without consent, or silent fallback | Single send function that requires a consent token; invariant tests; no code path from Private to Cloud | Bugs, covered by tests. |
| T15 | Private content leaking through logs, analytics, error reports, URLs | No analytics; content never in URLs or `localStorage`; server logs code only; test with marker strings | Browser extensions or OS features outside our control. |
| T16 | Clipboard, screenshots, app-switcher snapshots | Privacy cover on background; no auto-copy | User behaviour. |
| T17 | Cross-site request forgery on auth routes | Same-origin check on state-changing routes, SameSite=Lax | Low. |
| T18 | Account enumeration | Neutral responses for register and forgot | Login timing differences; accepted. |
| T19 | Cost abuse of cloud AI | Size caps, sign-in required, provider limits (5.6) | Accepted until you choose stronger limits. |
| T20 | Downgrade or rollback of format versions | Version and KDF floor checks on import and unlock | Low. |
| T21 | Device-level backups (OS cloud backup including app data) | Data is encrypted at rest; whether OS backups include website data is platform-dependent and **not verified** | Documented as unverified. |

Out of scope: a compromised OS, a physically coerced user, nation-state attackers, legal compulsion, and side-channel attacks on phones.

---

## 7. Phase-by-phase test plan

**Gates for every phase:** `tsc` clean; full unit and integration suite green; production build OK; Playwright run at desktop and 390×844 phone size; no "deluxe" references; no secret in the repo or bundle; accessibility checks (labels, focus order, contrast) on every new screen. **Real-device checks are listed separately because I cannot run them from here: they are your acceptance tests.**

### Phase 1. Independent Supabase authentication
- *Unit:* validation (email, password rules, byte limit); cookie writer (httpOnly, Secure, `__Host-`, remember vs session, deletion); config refuses a service-role key and a non-https URL; guard maps errors (missing session, revoked, Auth down → 503 not 401).
- *Integration with a fake GoTrue:* register (verify required), duplicate registration, invalid email, weak password, login right and wrong password, unconfirmed email, session persistence across requests, token refresh when the access token is near expiry, logout clears cookies and server session, forgot password (neutral), recovery link (token-hash and PKCE), reset requires the recovery marker, reset signs out other sessions, enumeration responses identical.
- *Protected routes:* proxy redirects signed-out page requests to `/login?next=…` (safe `next`); API returns 401 JSON; no redirect loops; signed-in users hit login → forwarded to the vault screen.
- *Security:* CSRF same-origin check; no tokens in any response body or HTML; no `NEXT_PUBLIC_` secrets; no Deluxe code.
- *Manual (you):* real-project checklist with a test mailbox: register, verify, login, forgot, reset, logout, session after refresh.

### Phase 2. Encrypted local vault and key management
- *Crypto unit tests:* AES-GCM round trip; AAD binding (moved record fails); IV uniqueness; HKDF key separation; Argon2id known-answer vectors; parameter floors enforced; wrap and unwrap; wrong passphrase rejected; tampered ciphertext rejected; passphrase change re-wraps without touching data; recovery-code unwrap; quick unlock fallback when its key is missing.
- *Vault tests (fake IndexedDB):* create, lock and unlock, auto-lock on timer and visibility, keys absent from memory after lock (no extractable keys); registry with several vaults; orphan vault screen.
- *Independence tests:* deleting all auth cookies and the marker does not stop unlock; a password reset leaves the vault database byte-identical; a second account gets a separate empty vault; no Supabase value appears in any KDF input.
- *Browser:* create vault, reload, unlock; lock on background; wrong passphrase delay.

### Phase 3. Local case management
- *Repository tests:* every function of today's `practice`, `work` repos reimplemented and tested (clients, cases, notes, hearings, drafts and versions, conversations and messages, analyses, dashboard aggregates, profile); blind-tag queries; schema upgrade test (v1 → v2 fixture); in-memory search.
- *Port of existing behaviour:* the two-advocate isolation tests become two-vault isolation tests.
- *Playwright:* create, edit and delete clients, cases, notes and hearings; calendar; dashboard; reload persistence; two accounts on one browser stay separate.

### Phase 4. Browser PDF processing and OCR
- *Spike first:* prove `unpdf` text extraction and page rendering plus `tesseract.js` in a worker in Chromium (and later a real iPhone) before building on it.
- *Tests:* text-layer PDF extraction; real OCR of a generated image-only PDF (the existing generator is reused); resumable page-batch progress after reload; page and size caps; malformed PDF rejected; PDFs stored as encrypted chunks and verified byte-for-byte after round trip; memory behaviour on a 60-page scan (documented, not asserted).
- *Real device:* OCR timing and memory on an iPhone and an Android phone.

### Phase 5. Private and cloud AI modes
- *Pure-module tests carried over:* citation guard (12), post-processing; provider tests (53) reduced to the Ollama provider and the stateless route.
- *Cloud:* consent required (no consent token → no request, asserted by counting network calls); the consent sheet shows the exact payload; **server stores and logs nothing** (marker-string test across logs and any persistence layer); size caps; sign-in required; Ollama errors mapped to friendly messages; answers saved locally only on request.
- *Private:* **no network request carries private content** (Playwright network interception with marker strings); capability detection; model download requires opt-in and hash verification; output validation and repair; guard applied; no silent fallback (test forces engine failure and asserts nothing is sent).
- *Real device:* engine speed, memory and quality on target phones; go or no-go for each Private feature.

### Phase 6. Local reminders
- *Unit:* scheduler picks due reminders after unlock; no duplicates after reload; time zones (IST) and DST-free correctness; `.ics` export with alarms (reusing the existing builder); privacy option for generic event titles.
- *Playwright:* reminder appears when due while the app is open; export file opens as valid iCalendar.
- *Real device:* confirm what iOS and Android actually do when the app is closed. The app will state that closed-app alerts need the phone's own calendar.

### Phase 7. PWA and offline support
- *Playwright offline:* after first load, `context.setOffline(true)`, reload and navigate; unlock and use local data; AI shows "needs internet"; registration and login show a clear offline message.
- *Tests:* manifest validity and icons; service-worker never caches `/api/*`; update flow; `persist()` result surfaced; storage estimate; CSP contains the needed `worker-src` and `wasm-unsafe-eval` and **no** Supabase host.
- *Real device:* Add to Home Screen on iOS, standalone launch, offline, persistence after days, behaviour under storage pressure.

### Phase 8. Encrypted export and import
- *Round trips:* export then import into a fresh vault reproduces every record and file byte-for-byte; large PDFs; empty vault.
- *Negative:* wrong password; flipped byte in each region; truncated file; reordered chunks; oversized counts; malformed records; unknown future version; weak-KDF downgrade rejected.
- *Safety:* import never overwrites (conflicts reported); dry-run shows counts; replace not offered; export file contains no plaintext (search for marker strings).
- *UX:* last export date, reminders at 7 and 30 days (D10); share sheet on mobile.

### Phase 9. Security audit and production readiness
Full threat-model walk-through against the built app; dependency audit and licence review; CSP and header review; secret scan; log-content audit; load and abuse checks on auth and AI routes; accessibility pass; documentation (user guide, recovery guide, privacy notice); production env checklist; a written cutover plan with rollback. **Production cutover, DNS, environment-variable changes and any Supabase production change happen only after separate, explicit approval.**

---

## 8. Retain / retire list

### 8.1 Retain unchanged
`src/lib/legal/*` (citation guard, known acts, draft types), `src/lib/ai/postprocess.ts`, `prompts.ts`, `schemas.ts`, `src/lib/ics.ts`, `src/lib/ai/providers/ollama.ts`, `src/lib/ai/errors.ts`, `src/lib/ai/types.ts`, `src/lib/pdf/extract.ts` (text-layer extraction), UI primitives (`components/ui.tsx`, `Markdown.tsx`), brand tokens in `globals.css`, `tests/citation-guard.test.ts`.

### 8.2 Retain with modification
`src/lib/config.ts` (drop DB, storage, Deluxe, cron settings), `src/lib/http.ts` (auth wrapper, error mapping; no database), `src/lib/http-errors.ts` (cookie support from `d85a21b`), `src/lib/validation.ts` (client-side schemas for local records), `src/lib/ai/client.ts` (split: provider selection and the generic JSON validate-and-repair loop move to a shared module usable in the browser and on the server), `src/lib/ai/context.ts` (rewritten over local data), `src/components/AppShell.tsx` and all 13 pages (rewired to local repositories), `src/app/layout.tsx`, `src/proxy.ts`, `next.config.ts` (CSP: add worker and wasm directives, remove the Supabase host), `scripts/check-env.mjs`, `scripts/smoke.mjs`, `scripts/e2e.mjs` (rewritten), `README.md`, `.env.example`, `vercel.json` (remove the cron).
From `d85a21b` **reuse after review and tests**: `src/lib/auth/supabase.ts`, `src/lib/auth/validation.ts`, `src/lib/auth/guard.ts`, the `supabaseAuthConfig` part of `config.ts`, `HttpError.cookies`.

### 8.3 Retire (delete from the integration branch; history keeps them)
*Decision record 6: the server data layer is retired only after the local-first work passes; until then it remains for synthetic-data tests behind a visible warning.*

- **Deluxe:** `src/lib/auth/provider.ts`, `session.ts`, `routes.ts`, `src/app/auth/callback/page.tsx`, `api/auth/start`, `api/auth/callback`, all `DELUXE_*` config and docs, the Deluxe-based `tests/auth.test.ts` and E2E harness; dependency `jose`.
- **Server data layer:** `src/lib/db/*` (client, schema, repos, diagnostics), `src/lib/storage/*`, `src/lib/pdf/ocr.ts` (Node OCR; replaced in Phase 4), and the data and document routes: `cases`, `clients`, `conversations`, `analyses`, `analysis`, `documents/*`, `drafts/*`, `hearings/*`, `notifications/*`, `dashboard`, `profile`, `cron/reminders`, `health/db`, `ai/test`. Dependencies `drizzle-orm`, `postgres`, `@electric-sql/pglite`, `@napi-rs/canvas`, `tesseract.js` (server use) and the server-side `@tesseract.js-data/*` copying code.
- **Server-bound tests:** `practice`, `ai` (DB route tests), `migration`, `health-db`, `ocr`, `pdf` (rewritten for the browser path), `harness`, `helpers` (DB parts).
- **AI providers (decision 9.6):** SambaNova and Anthropic providers and their tests, if you confirm Ollama is the only cloud option.
- **From `d85a21b`:** `ensureAdvocate`, the `advocates.email` and schema edits, `http.ts` database coupling, migration `0003`.
- **From `fb24159`:** the whole commit.

### 8.4 Migrations and databases
| Item | Action |
|---|---|
| `supabase/migrations/0001_init.sql`, `0002_ocr.sql` | Applied earlier to **both** Supabase projects; all 13 tables are empty. **Leave untouched.** Mark deprecated in the repo; nothing is dropped without your explicit approval. They are removed from the app's runtime (nothing reads them). |
| `0003_supabase_auth.sql` (branch `claude/supabase-auth`, never applied) | **Discard.** *Update: PR #2 (`claude/own-auth`) carries a newer `0003` for the synthetic-data server mode; it is retired together with server mode.* |
| Old project `tcrprxgwhfsdkfiatmpe` (also hosts the other app's `fe_bridge`) | Not touched. |
| New project `aezfuotsjwhdtuwjlcxx` | Keeps **Auth**; its empty tables and `case-documents` bucket are unused. |
| Production `main` (`5635de9`) | Unchanged until an approved cutover; no production environment variable or deployment changes before then. |

---

## 9. Decisions and assumptions to confirm
**Status after the Decision record:** 9.1 resolved: recovery is deferred. 9.3 resolved: ask before every cloud send (an existing requirement). 9.4 resolved in principle: counters approved; the mechanism and retention are open. 9.5 resolved by decision 6 (the server mode stays for synthetic tests); the resulting Phase 1 scope is still to be re-confirmed. **Still open:** 9.2, 9.6, 9.7, 9.8, 9.9 (who runs the real-device tests, reviewer and device matrix) and 9.10. The list below keeps its original wording.

1. **Recovery code:** offer an optional recovery code at vault creation (recommended), or only passphrase plus backup? *(Resolved: deferred until after the encryption review.)*
2. **Offline unlock:** how long may the offline session marker be trusted (proposed 30 days), and must the matching account be signed in to unlock a vault online?
3. **Cloud consent frequency:** ask on every send (recommended), or allow "don't ask again this session"?
4. **Abuse control:** option (a) now, upgrade to counters only if needed (recommended), or add counters from the start?
5. **Interim state:** accept an un-deployable integration branch between Phases 1 and 3 with a clean stub (recommended), or a temporary shim that keeps server data routes alive?
6. **AI providers:** retire SambaNova and Anthropic so Ollama is the only cloud option (recommended)?
7. **Private-mode scope:** accept that the model and feature scope is decided after real-phone tests at the end of Phase 5, possibly limited to simple tasks.
8. **SMTP:** a custom email sender for production verification and reset mail (needs your account; Supabase's default sender is not suitable for real use).
9. **Real-device testing:** I cannot run an iPhone or Android phone from here. Are you able to run the device checklists in section 7 at the end of Phases 4, 5, 7 and 8?
10. **Registration notice:** the data-loss dialog and the Settings → Data & Privacy page (with your exact wording and an honest note about AI requests) are built in Phase 2 (vault creation) and Phase 8. Confirm that the notice may also appear at vault creation, not only at account registration.

**Not changing, ever, without a separate approval:** Deluxe Main or Deluxe Drive; production secrets or environment variables; Supabase production data or schemas; deployments; pushing or merging to `main`.

---

## Sources
- [WebGPU is now supported in major browsers (web.dev)](https://web.dev/blog/webgpu-supported-major-browsers)
- [WebGPU in iOS 26 (App Developer Magazine)](https://appdevelopermagazine.com/webgpu-in-ios-26/)
- [WebKit Bugzilla 311598: iOS WebGPU command-buffer throttling](https://bugs.webkit.org/show_bug.cgi?id=311598)
- [WebKit Bugzilla 275958: WebLLM buffer size and iOS memory kills](https://bugs.webkit.org/show_bug.cgi?id=275958)
- [WebKit: Updates to Storage Policy](https://webkit.org/?p=14403)
- [MDN: Storage quotas and eviction criteria](https://developer.mozilla.org/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria)
- [Apple Developer Forums: Safari iOS PWA data persistence beyond 7 days](https://developer.apple.com/forums/thread/710157)
- [Ollama pricing page (no recording, logging or training statement)](https://ollama.com/pricing)
- [Ollama privacy policy](https://ollama.com/privacy)
- [Ollama cloud documentation](https://docs.ollama.com/cloud)
- [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
