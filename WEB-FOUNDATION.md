# BDM-AI Web Foundation

Next.js web front end for the BDM personal AI assistant. This repository is
separate from the Python desktop assistant (Aegis) and stays that way.

## Structure

```
app/
  layout.tsx            Root layout + metadata
  page.tsx              Chat interface
  styles.css            Visual design
  api/
    chat/route.ts       POST /api/chat  - server-side AI request flow
    health/route.ts     GET  /api/health - deployment health check
lib/
  supabase.ts           Supabase client factory
tests/                  Vitest unit + API tests (mocked provider)
```

`page.tsx`, `layout.tsx` and `route.ts` previously sat at the repository root,
which Next.js does not treat as routes. The App Router requires files under
`app/`; the health handler was also missing its `/api/health` path entirely.

## Commands

```
npm ci                  reproducible install from package-lock.json
npm run typecheck       tsc --noEmit
npm run lint            eslint
npm run test            vitest (mocked provider, no key required)
npm run build           production build
npm run dev             local dev server
npm run verify          all of the above
```

## Environment

Copy `.env.example` to `.env.local` and fill in real values.

| Variable | Required | Notes |
| --- | --- | --- |
| `OPENAI_API_KEY` | yes | Server-side only. Never expose to the browser. |
| `OPENAI_MODEL` | yes | Default `gpt-5.6-luna`, verified against the Responses API model list. |
| `BDM_WEB_SEARCH_ENABLED` | no | `true` enables the provider `web_search` tool. |
| `NEXT_PUBLIC_SUPABASE_URL` | for auth/persistence | Public values only. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | for auth/persistence | Publishable key only, never a service-role key. |

## API contract

`POST /api/chat` with `{"message": "..."}`.

Success `200`:

```json
{ "id": "resp_...", "model": "gpt-5.6-luna", "text": "..." }
```

Failures return a generic, non-leaking message. Provider errors, stack traces
and credentials are logged server-side only.

| Status | Meaning |
| --- | --- |
| 400 | Missing, empty, non-string, or unparseable message |
| 413 | Message over 20,000 characters |
| 429 | More than 20 requests per minute from one client |
| 500 | Provider not configured, or provider failed |
| 502 | Provider returned no content |

The rate limiter is per-instance and in-memory. A shared store is required
before running more than one instance.

## Security posture

- The OpenAI key is only read server-side, inside the route handler.
- Browser-supplied text is never executed as shell or code; it is passed to
  the model as data only.
- `next.config.ts` sets `poweredByHeader: false`.
- Production dependencies (`npm audit --omit=dev`) report 0 vulnerabilities.

The five remaining advisories are dev-only, all reaching the `braces` package
through eslint-config-next's transitive `micromatch` dependency. They affect
`npm run lint` only, never the shipped bundle. Clearing them would require
downgrading eslint-config-next to v14, which is incompatible with Next 16, so
they are accepted and tracked rather than silently ignored.

## Not yet implemented

Authentication, per-user conversation persistence, memory retrieval, and RLS
policies are not built. See the project roadmap; the Supabase tables named in
`README.md` have not been verified against a live instance.
