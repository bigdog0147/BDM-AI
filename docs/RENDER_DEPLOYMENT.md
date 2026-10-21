# Render deployment and rollback runbook

Service: `bdm-ai` - <https://bdm-ai.onrender.com/>
Plan: free (the instance sleeps when idle; the first request after a sleep can
take a few seconds and may briefly return `503` while it wakes).

Nothing in this document has been executed. No deployment, push, migration or
secret change has been made.

---

## 1. Before anything is deployed

### 1.1 Close other work on the repository

A second AI session was editing the same working tree during the redesign and
committed `7565860` to the same branch. Confirm it is stopped before
publishing, so nothing lands mid-deploy.

```
git log --oneline -5
git status
```

Expect a clean tree apart from `supabase/vector-socket-fix-2026-10-19.md`,
which is an untracked local note and is not part of the change set.

### 1.2 Verify the branch locally

```
npm ci
npm run verify
```

Expected: typecheck clean, lint 0 errors, 344 tests passing, build succeeds.

Then run the app and walk the checklist:

```
npm run dev:preview        # next dev -p 3011
```

| # | Check | Expected |
| --- | --- | --- |
| 1 | `http://127.0.0.1:3011/` | Sidebar, centred conversation, composer with Research / Voice note / Image / Email |
| 2 | Collapse the sidebar | Icon rail; expand again |
| 3 | Send a message | Exactly one user message and one reply |
| 4 | Press Stop mid-reply | The request cancels and a retry is offered |
| 5 | Voice note | Record, Stop, preview, transcribe, edit, insert, send - one message only |
| 6 | Research toggle | The placeholder becomes "Ask a research question..." |
| 7 | `/auth` | "Continue with Google" is present; the notice appears when Google is unconfigured |
| 8 | `/settings` | The Environment section lists names and PRESENT / NOT SET, never values |
| 9 | 390px viewport | Single column, sidebar behind the hamburger, no horizontal scroll |
| 10 | Keyboard: press Tab | The skip-to-conversation link appears first |

---

## 2. Configuration the owner must set

### 2.1 Google sign-in (not yet live)

Create a **Web application** OAuth client in Google Cloud Console.

| Setting | Value |
| --- | --- |
| Authorized redirect URI | `https://bdm-ai.onrender.com/auth/callback/google` |
| Authorized JavaScript origin | `https://bdm-ai.onrender.com` |
| Local redirect URI (development) | `http://localhost:3011/auth/callback/google` |

Then in the Render dashboard:

| Variable | Value | Currently |
| --- | --- | --- |
| `GOOGLE_CLIENT_ID` | from Google Cloud | **missing** |
| `GOOGLE_CLIENT_SECRET` | from Google Cloud | **missing** |
| `GOOGLE_REDIRECT_URI` | `https://bdm-ai.onrender.com/auth/callback/google` | set in `render.yaml` |

And in Supabase Auth, enable the **Google** provider with the same client ID
and secret.

**Apply the migration** (never against production without a deliberate step):

```
supabase/migrations/0004_google_identities.sql
```

It creates `bdm_google_identities`, the table that records which Google
subject ID maps to which BDM user. Without it, Google sign-in stays disabled
on purpose, because the guard that stops a Google login from being linked to
a password account by email alone is not available.

Verify in Supabase that `0002_usage_quotas.sql` and `0005_rls_grants.sql` are
also applied. The live status endpoint reports `migrationState: "unknown"`,
so do not assume.

### 2.2 Web research

`TAVILY_API_KEY` is **set in the Render dashboard** but was missing from
`render.yaml`; it is now declared there. Confirm the dashboard value is still
present - a blueprint sync could otherwise have cleared it. `BRAVE_SEARCH_API_KEY`
and `SEARXNG_URL` are alternatives; only one is needed.

### 2.3 Email (currently broken in production)

`BDM_EMAIL_ENABLED=true` is set, but `RESEND_API_KEY` and `RESEND_FROM_EMAIL`
are not. Either add both, or set `BDM_EMAIL_ENABLED=false`. Until then the
Email tool in the composer will not work.

### 2.4 Other variables

| Variable | Status | Notes |
| --- | --- | --- |
| `AI_PROVIDER` | set (`ollama`) | Ollama Cloud |
| `OLLAMA_API_KEY` / `OLLAMA_API_MODEL` / `OLLAMA_API_HOST` | set | `gemma4:31b` on `https://ollama.com` |
| `OPENAI_API_KEY` / `OPENAI_MODEL` | set | Voice transcription and image generation |
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | set | Browser-visible, publishable only |
| `SUPABASE_SERVICE_ROLE_KEY` | set | Server-only. Required for the Google guard and durable quotas |
| `RESEND_WEBHOOK_SECRET` | set | Webhook signature verification |

---

## 3. Deploy

1. Open a pull request from `feature/workspace-redesign` and review
   `docs/PR_DESCRIPTION.md`.
2. Merge to `main`.
3. In Render, create a **Preview** instance from the branch and let the
   blueprint apply. Do not promote straight to production.
4. On the preview instance, set the Google variables if the preview is to be
   used for the Google test, and point the Google OAuth client at the preview
   origin as well.
5. Verify on the preview:

   ```
   GET https://<preview-host>/api/status
   ```

   Expect `google.configured: true`, and `google.callbackUrl` equal to the
   preview's own callback URL. Confirm the manifest is the richer one:

   ```
   GET https://<preview-host>/manifest.json
   ```

   Expect `"name": "BDM - Personal AI"`, three icons and two shortcuts.
6. Promote the preview to production, then repeat the same two checks on
   `https://bdm-ai.onrender.com`.
7. Complete a real Google sign-up, a returning Google sign-in, and a password
   account that connects Google from Settings. Confirm that a password account
   is never linked by email alone.

---

## 4. Rollback

### Code
Render's **Rollback to this deploy** on the previous successful deploy. It is
instant and changes no data. The previous known-good commit is
`5c56cc0` on `main`.

### Schema
Every migration is additive - `create table if not exists`, `enable row level
security`, `create or replace function`. Rolling the application back never
requires a down-migration. If one is ever needed it is a separate, explicitly
approved task; do not improvise one during an incident.

### Configuration
Restore the previous values in the Render dashboard. The only variables that
changed are `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and
`GOOGLE_REDIRECT_URI`; `TAVILY_API_KEY` was already set.

### Local
```
git branch backup/pre-redesign-2026-10-21   # points at the pre-redesign HEAD
git checkout backup/pre-redesign-2026-10-21
```
File-level restores are also available under `private-audit/backups/`.

---

## 5. Post-deploy checks

| # | Check | Command or action |
| --- | --- | --- |
| 1 | Health | `GET /api/health` returns `{"ok":true,...}` |
| 2 | Capabilities | `GET /api/status` - AI, search, voice and images all `configured: true` |
| 3 | Diagnostics | `GET /api/status` - the `environment` array has names and booleans only; confirm no value appears |
| 4 | Manifest | `GET /manifest.json` - one manifest, the richer one |
| 5 | Google | Sign in, sign up, returning sign-in, and a password account linking from Settings |
| 6 | Voice | Record and transcribe a short note; confirm one message is produced |
| 7 | Research | Run one question; confirm the answer carries real source links |
| 8 | Quotas | `quotas.migrationState` is no longer `unknown` |
