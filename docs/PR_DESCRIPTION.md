# Redesign BDM Personal AI as a focused personal AI workspace

## Summary

Turns the BDM dashboard into a focused, premium personal AI workspace and lands
the three capabilities that were previously only partially wired: Google
sign-in, voice notes, and real web research.

The home screen is now one conversation and a composer. Provider readiness,
integrations and environment status moved to `/settings`, where they belong.

Nothing in the existing architecture was replaced. Supabase Auth still issues
the session, the AI provider layer is unchanged, and the data model is the
same one that was already in place.

## What changed

### Workspace shell

- Two-column layout: a collapsible navigation sidebar and a centred
  conversation column capped at 880px.
- The sidebar carries New chat, Chat, Research, Voice note, Saved items, the
  conversation history you own, Settings, Help, and the account controls with
  sign-out. It collapses to an icon rail on desktop and becomes a drawer
  below 1024px.
- The right-hand status rail is gone. Quick actions live in the sidebar and the
  composer, recent conversations live in the sidebar history, and the system
  status moved to `/settings`.
- The empty state is a restrained welcome with four suggestions that each
  perform a real action.
- A skip-to-conversation link is rendered for keyboard users.

### Google sign-in

- Server-side OpenID Connect authorization-code flow with PKCE.
- The ID token is verified against Google's published JWKS: signature, issuer,
  audience, expiry, nonce and the `email_verified` claim, all before the
  identity is trusted.
- `state`, `nonce` and the PKCE verifier live in a short-lived httpOnly
  cookie.
- Only `openid email profile` scopes are requested.
- The session is still minted by Supabase Auth (`signInWithIdToken`), so no
  second authentication system is created.
- **Account linking is explicit.** A Google login never attaches to a password
  account because the email matches. `bdm_google_identities` records the link
  between Google's subject ID and the existing BDM user, and an existing
  password account must sign in first and connect Google from Settings.
- The sign-in and sign-up screens gain a recognisable **Continue with
  Google** button, and a notice when the server has not been configured for it
  yet, so the button is never a dead end.

### Voice notes

- Explicit record button, then a microphone permission request. Nothing is
  recorded in the background.
- Recording indicator, elapsed time, Stop, Discard, an audio preview, and a
  review step before anything is sent.
- The transcript is editable and is inserted into the composer, so the
  confirmed text goes through the same pipeline as a typed message.
- Audio is held in memory for the request only. Nothing is written to disk,
  the database or object storage, and nothing is logged.
- Server side: MIME allow-list, size and duration ceilings, an upload guard
  before the body is parsed, a burst limiter and a durable daily quota.

### Web research

- `brave`, `tavily` and `searxng` adapters with normalised sources.
- Only the user's question reaches the search provider. Never the
  conversation, the memories or the account data.
- Retrieved pages are treated as untrusted data: content is escaped inside
  `<source>` blocks and the system prompt forbids following instructions found
  in results.
- Citations are validated against the real source list, so an invented `[7]`
  can never be displayed next to a five-item list.
- The provider key stays on the server and is never returned by `/api/status`.

### Diagnostics

- `/settings` now lists every environment variable the application reads, with
  its name, its purpose, and whether a value is present. **No value is ever
  read into the page, shown, or logged.**
- `/api/status` exposes the same report, plus the exact authorized redirect
  URI and JavaScript origin for the current deployment.

## Defects fixed along the way

- **Two manifests both served `/manifest.json`.** The `app/manifest.json` route
  shadowed the richer static file, so the installed app advertised the smaller
  manifest and never referenced `icon-192.svg`. The route is removed.
- **The manifest "Research" shortcut was nonfunctional** - it pointed at
  `/?view=research`, which nothing handled. The workspace now reads the query
  and arms Research.
- **The service worker was never registered.** It is now mounted from the root
  layout and gated to production, because a cached shell would make hot reload
  look broken in development.
- **The brand monogram read "BPM".** Its second letter closed at mid-height.
  It now closes on the baseline and reads "BDM".
- **The theme toggle did nothing** - it set `data-theme` with no CSS behind it.
  It has been removed rather than left as a dead control.
- **92 dead CSS rules** for the retired status rail and hero empty state were
  pruned. `tools/prune-dead-css.mjs` only removes a rule when every selector in
  it names a retired class, and refuses to run if any of those names is still
  rendered.
- **A leftover `1280px` media query** forced a 272px sidebar column on phones.
  Mobile is now a single full-width column.

## Verification

```
npm run verify      # typecheck && lint && test && build
```

- `tsc --noEmit` - clean
- `eslint .` - 0 errors. 8 warnings, all pre-existing, in `public/sw.js` and
  three test files.
- `vitest run` - 24 files, 344 tests, all passing. Every provider is mocked,
  so no search or model credits are consumed and no account is created.
- `next build` - succeeds, 35 routes.

New coverage added in this branch:

- `tests/workspace-shell.test.tsx` - sidebar navigation, history, account
  controls, collapse, the Google button and its error states, and the full
  record to transcribe to review flow including permission denial, discard and
  failure recovery.
- `tests/google-callback-route.test.ts` - state mismatch, cancelled and denied
  consent, missing configuration, a linking attempt without a session, the
  order of token verification, and that no state, nonce or client secret ever
  reaches a redirect.
- `tests/status-diagnostics.test.ts` - that the environment report contains
  names and presence only, and that a secret set in the environment never
  appears in the response.

## Deployment

See `docs/RENDER_DEPLOYMENT.md`. Google sign-in stays switched off until the
OAuth client exists and `supabase/migrations/0004_google_identities.sql` has
been applied.

## Notes for review

- The workspace was developed alongside a second session that was editing the
  same files. Both sets of changes are preserved in the history: `c5bf8b2`
  preserves the redesign, `7565860` adds the premium accent layer, and
  `8514ada` fixes the manifest and prunes the dead styles.
- `app/premium.css` is a purely additive accent layer. It changes no
  structural selector.
- No production deployment, push or migration is included in this branch.
