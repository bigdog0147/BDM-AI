# BDM AI

BDM is a standalone personal AI platform designed to become a continuously upgradeable assistant with memory, internet research, tools, voice, files, automation, and mobile applications.

## V1 foundation

- Next.js web application
- OpenAI Responses API model gateway
- Optional built-in web search
- Supabase-ready data layer
- Render deployment blueprint
- Health endpoint at `/api/health`
- Starter BDM conversational interface

## Existing Supabase foundation

The connected Supabase project already contains the BDM V1 tables:

- `bdm_profiles`
- `bdm_conversations`
- `bdm_messages`
- `bdm_memories`
- `bdm_knowledge_items`
- `bdm_tool_permissions`
- `bdm_audit_events`

Row Level Security is enabled on these tables.

## Local setup

1. Copy `.env.example` to `.env.local`.
2. Add your OpenAI API key to `OPENAI_API_KEY`.
3. Add the Supabase project URL and publishable key.
4. Run `npm install`.
5. Run `npm run dev`.

Never commit API keys or secret credentials.

## The workspace

The dashboard is a focused personal AI workspace:

- **Left sidebar** - New chat, Chat, Research, Voice note, Saved items, the
  conversation history you own, Settings, Help, and the account controls with
  sign-out. It collapses to an icon rail on desktop and becomes a drawer on
  small screens.
- **Centre column** - the conversation, with the composer docked at the
  bottom. The composer carries the three ways to talk to BDM: type, speak a
  voice note, or switch on Research to ask the live web.
- **Settings** (`/settings`) - account, Google connection, capability report,
  environment diagnostics, privacy, and data export/import. Provider
  diagnostics deliberately live here and not on the home screen.

`/api/status` is the machine-readable version of the same report. It returns
variable **names** and whether a value is present - never a value.

## Capabilities

| Feature | Where | Required configuration |
| --- | --- | --- |
| Chat | `/api/chat` | None. Defaults to local Ollama. |
| Google sign-in | `/auth`, `/api/auth/google/start`, `/auth/callback/google` | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SUPABASE_SERVICE_ROLE_KEY` + the Google provider enabled in Supabase Auth |
| Long-term memory | `/api/memories`, Memory panel | Supabase URL + publishable key, signed-in user |
| Web research | `/api/research`, Research button | One of `BRAVE_SEARCH_API_KEY`, `TAVILY_API_KEY`, `SEARXNG_URL` |
| Image generation | `/api/images`, Image button | `OPENAI_API_KEY` |
| Voice notes | `/api/transcribe`, Voice note button | `OPENAI_API_KEY` |
| Email sending | `/api/email/send`, Email button | `BDM_EMAIL_ENABLED=true`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL` |
| Delivery webhooks | `/api/webhooks/resend` | `RESEND_WEBHOOK_SECRET` (+ `SUPABASE_SERVICE_ROLE_KEY` for storage) |
| Password reset / verification resend | `/api/auth/password-reset`, `/api/auth/resend-verification` | Supabase Auth email configured for the project |

### Google sign-in

Google sign-in is a server-side OpenID Connect flow with PKCE. It reuses the
existing Supabase Auth user and session - BDM does not run a second auth
system.

1. In Google Cloud Console, create a **Web application** OAuth client.
2. Add the **Authorized redirect URI**:
   `https://bdmai.cloud/auth/callback/google`
   (and `http://localhost:3001/auth/callback/google` for local development).
3. Add the **Authorized JavaScript origin**: `https://bdmai.cloud`.
4. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in the server
   environment. `GOOGLE_REDIRECT_URI` should be set explicitly in production
   so the registered value cannot drift.
5. Enable the Google provider in Supabase Auth with the same client ID and
   secret, and apply `supabase/migrations/0004_google_identities.sql`.
   `SUPABASE_SERVICE_ROLE_KEY` is required: it backs the guard that refuses
   to link a Google login to an existing password account purely because the
   email matches.
6. Set `SUPABASE_SERVICE_ROLE_KEY` in the server environment.

A first-time Google sign-in creates an account through the normal signup
rules. A returning sign-in looks up the stored link between Google's subject
ID and the existing BDM user. Existing password accounts must sign in with
their password first and connect Google from **Settings** - BDM never links
by email alone.


### Durable quotas

Every paid or abuse-prone endpoint is limited by a counter in Supabase
(`bdm_usage_counters`), incremented by an atomic `SECURITY DEFINER` function
(`supabase/migrations/0002_usage_quotas.sql`). In-process limiters remain only
as short burst guards. If the migration is missing, paid features fail closed
with `503 quota_unavailable` instead of spending without a ceiling.

| Feature | Window | Default |
| --- | --- | --- |
| Images | UTC day | 20 per user |
| Transcription | UTC day | 50 per user |
| Research | UTC day | 40 per user / per anonymous IP |
| Email send | UTC day | 20 per user |
| AI email draft | UTC day | 50 per user |
| Verification email | UTC day per address | 5 |
| Verification attempts | Hour per IP | 10 |
| Reset email | UTC day per address | 5 |
| Reset attempts | Hour per IP | 10 |

All values can be overridden with the `BDM_QUOTA_*` variables listed in
`.env.example`.

### Email

Sending is deliberately conservative:

- disabled unless `BDM_EMAIL_ENABLED` is exactly `true`, and both
  `RESEND_API_KEY` and `RESEND_FROM_EMAIL` are present;
- one recipient per message, validated, with CR/LF rejected everywhere to
  prevent header injection;
- the sender is always the configured `RESEND_FROM_EMAIL`;
- AI drafting returns text only and never calls the provider's send endpoint;
- sending requires `confirmed: true`, which the UI sets only after the user
  has seen and approved the exact recipient, subject, and body.

The Resend key is server-only and is never returned by `/api/status`.

Delivery events are received at `/api/webhooks/resend`. The endpoint is
unauthenticated but every request must carry a valid Svix signature
(`svix-id`, `svix-timestamp`, `svix-signature`) computed from
`RESEND_WEBHOOK_SECRET`; stale timestamps are rejected to prevent replay.
Only the event type, provider message id, and timestamps are stored in
`bdm_email_events` — never recipients, subjects, or bodies. That table has RLS
enabled with no policies, so durable storage uses the server-only
`SUPABASE_SERVICE_ROLE_KEY`. Without that key the endpoint still verifies and
acknowledges events but reports `stored: false`.

### Supabase auth emails

Confirmation and recovery tokens are generated and verified by Supabase Auth;
this app does not implement its own tokens. `signup`, `resend-verification`,
and `password-reset` are throttled by two independent budgets (address/day and
IP/hour) stored in the quota table. Recoveries complete at `/auth/reset`,
where the browser client exchanges the Supabase link and calls
`updateUser({ password })`.

### Memory

Long-term memory is stored in `bdm_memories` and scoped by `user_id` with Row
Level Security; queries also filter on `user_id` explicitly as defence in
depth. Optional project scoping uses `metadata.project`, so no schema change
was needed.

Only explicit instructions are written: `remember this: …`, `remember that …`,
`forget …`. Inferred conversation content is never auto-saved. Content that
looks like a credential (API key, token, password, private key) is refused.
The Memory panel lists, searches, corrects, pins, and deletes memories, and
can clear conversation history without touching saved memories.

Retrieval is keyword-overlap ranking (`lib/memory-core.ts`); only matching or
pinned memories enter the prompt, and a missing/unavailable store degrades to
"no memories" rather than an error.

### Research

`lib/search.ts` adapts Brave, Tavily, or SearXNG and returns normalized
sources with title, URL, domain, and date. `lib/research.ts` builds the
synthesis prompt: page content is wrapped in `<source>` blocks, escaped so it
cannot forge a boundary, and the system prompt forbids following instructions
found in results. Citations use `[n]`, are validated against the real source
list, and invented indices are dropped. Only the user's explicit query is sent
to the provider.

Research is reachable two ways, both through the same `/api/research`
endpoint: the **Research** button in the composer runs the question inside the
current conversation, and the **Research** item in the sidebar opens the
dedicated research workspace. The Tavily key stays on the server; it is never
returned by `/api/status` and never reaches the browser.

### Images and voice

Both call OpenAI only from the server and are disabled with a visible
"not configured" state when `OPENAI_API_KEY` is missing. Image requests are
limited to one image, an allow-list of sizes, low quality by default, 5 per
10 minutes, and 20 per day per user (database-backed). Voice recordings are
capped at 25 MB and 5 minutes, validated by type, held in memory only — no
temp file and no database row — and limited to 50 per day per user. The
transcript is shown for editing before it is sent through the normal chat
pipeline.

## Workspace interface and brand (2026-10)

The chat surface was rebuilt as a focused personal-AI workspace:

- a **collapsible left sidebar** (New chat, Chat, Research, Voice note, Saved
  items, the conversation history, Settings, Help, and the account chip with
  sign-out). It collapses to an icon rail on desktop and becomes a drawer
  below 1024px;
- a **central conversation column** with a restrained empty state and a
  composer docked at the bottom;
- **no right-hand status rail.** Quick actions live in the sidebar and the
  composer, recent conversations live in the sidebar history, and provider
  readiness moved to **Settings**, so the home screen is not a configuration
  page.

The composer carries the three ways to talk to BDM - type, speak a voice note,
and switch on Research to ask the live web - and shows honest states for
loading, recording, transcribing, searching, error, empty and success.

### Brand assets

All artwork is original vector geometry - no raster image, no embedded
base64, no remote font.

| Path | Use |
| --- | --- |
| `public/brand/bdm-logo.svg` | Full lockup: emblem, BDM wordmark, `PERSONAL AI` label |
| `public/brand/bdm-mark.svg` | Compact emblem for the sidebar, avatars, small sizes |
| `public/brand/bdm-mark-light.svg` | Compact emblem for light surfaces |
| `public/brand/bdm-emblem.svg` | Detailed round mark used in the welcome state |
| `app/icon.svg` | Browser favicon |
| `app/apple-icon.tsx` | Generated home-screen icon (same geometry) |
| `app/manifest.ts` | Web app manifest |
| `app/brand/page.tsx` | Owner review sheet: every asset on dark and light |

Every surface renders the brand through the single `BrandLogo` component, so
the dashboard and the brand sheet can never drift apart.

### Stylesheets

`app/styles.css` imports three layers, in order, so every screen shares one
visual language: `app/workspace.css` (tokens and shared components),
`app/dashboard.css` (the workspace shell: sidebar, conversation, composer),
and `app/components.css` (the account, settings and research screens).

### Google sign-in

`lib/google-auth.ts` performs a server-side OpenID Connect authorization-code
flow with PKCE against Google. The ID token is verified against Google's
published JWKS: signature, issuer, audience, expiry, nonce and the
verified-email claim are all checked before the identity is trusted. The
`state` value and the PKCE verifier live in a short-lived httpOnly cookie
(`bdm_google_oauth`).

The session itself is still issued by Supabase Auth
(`signInWithIdToken`), so no second auth system is created and the existing
httpOnly cookie session keeps working.

**Account linking is explicit.** A Google sign-in never attaches to a
password account because the email matches. The guard table
(`supabase/migrations/0004_google_identities.sql`) records which Google `sub`
was deliberately linked to which BDM account; the server refuses a silent
link, so an existing password account must sign in first and then connect
Google from `/settings`.

Owner setup:

1. Google Cloud Console -> create an **OAuth 2.0 Web application** client.
2. Authorized redirect URI: `https://bdmai.cloud/auth/callback/google`
   (and `http://localhost:3001/auth/callback/google` for local development).
3. Authorized JavaScript origin: `https://bdmai.cloud`.
4. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `GOOGLE_REDIRECT_URI`
   in the server environment (Render dashboard for the live app).
5. Set `SUPABASE_SERVICE_ROLE_KEY` (server only) and apply
   `supabase/migrations/0004_google_identities.sql`.
6. Enable the Google provider in Supabase Auth with the same client id and
   secret, so Supabase can mint the session from the verified ID token.

Until those steps are done, `/api/auth/google/start` redirects to
`/auth?error=google_not_configured` and the sign-in screen says so plainly.

## Known dependency advisories

`npm audit` reports 5 high-severity advisories. All of them are **dev
tooling** and none of them ship with the application — the chain starts
inside the Next.js lint plugin:

```
eslint-config-next
└── @next/eslint-plugin-next
    └── fast-glob
        └── micromatch
            └── braces      ← GHSA-vfj7-8cjw-p6xm
```

`braces` is published only up to `3.0.3`, and the advisory covers
`<= 3.0.3` — the newest release is the affected one, so no upgrade can clear
it. `npm audit --omit=dev` (the production tree) reports **0**.

How this is handled:

- **Production dependencies are gated in CI.** `npm audit --omit=dev
  --audit-level=high` must pass; it is green today and blocks on any
  high-or-worse advisory in the shipped tree.
- **Dev advisories are ratcheted, not ignored.** A weekly job compares the
  count against `.audit-baseline.json` and fails only if it rises. When an
  upstream fix lands and the count drops, lower the baseline.
- The lint step is bounded by `timeout-minutes: 10`, so a pathological glob
  can fail a pipeline rather than stall one.

## Planned upgrades

1. Tool permission engine
2. Durable image storage (object storage) so generated images can be revisited
3. Automations
4. Specialist BDM agents
5. Android/iOS app clients

Supabase auth, conversation persistence, long-term memory, source-backed web
research, image generation, voice notes, transactional email, and durable
database-backed quotas are implemented.
