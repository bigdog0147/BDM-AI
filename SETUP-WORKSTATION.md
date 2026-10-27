# BDM-AI Feature Audit Report — 2026-10-27

Verified only; no source code changed; no destructive commands; `.env` values never exposed.

---

## Inspection scope

Files inspected (read-only):
- `app/page.tsx` — chat UI
- `app/api/chat/route.ts` — chat endpoint
- `app/api/health/route.ts`
- `lib/conversations.ts` — Supabase persistence
- `lib/agents/MemoryManager.ts` — memory management
- `lib/agents/Orchestrator.ts`, `MasterAgent.ts`, `Dispatcher.ts`, `Agent.ts`
- `lib/providers/openai.ts`, `ollama.ts`, `types.ts`
- `package.json`, `.env.example`, `.env.local` (names only)

---

## A — Persistent AI Memory

Status: **Partially implemented.**

Evidence:
- `MemoryManager` (`lib/agents/MemoryManager.ts`): stores entries in a private `Map` (`store.entries`). No database writes. Not persistent across server restarts.
- Conversation history (`lib/conversations.ts`): stored in Supabase (`bdm_conversations`, `bdm_messages`) with anonymous fixed user ID (`00000000-0000-0000-0000-000000000001`). No real auth/user scoping.
- Chat UI (`app/page.tsx`): holds messages in React state; no persistent memory UI; no review/edit/delete for memory entries.
- Chat route (`route.ts`): passes `conversationHistory` (filtered `user`/`assistant` messages) to master agent.
- No memory-specific database table (`bdm_memories`).

Findings:
- Memory is not persistent across restarts (in-memory only).
- Not user-scoped correctly (anonymous UUID for all users).
- No user-facing memory review, correction, or deletion.

Smallest fix:
- Create `bdm_memories` table or extend `bdm_conversations` schema for long-term facts.
- Link to real user/auth instead of anonymous UUID.
- Add UI for viewing/editing/deleting memories.

---

## B — Voice Notes and Transcription

Status: **Missing / Unverified.**

Evidence:
- Zero references to `voice`, `audio`, `record`, `microphone`, `transcription`, `whisper`, `stt` in `app/`, `lib/`, `package.json` scripts, or `.env` variable names (`.env.local` only has provider/model/search settings).
- `app/page.tsx`: only text `<textarea>` input; no `<input type="file" accept="audio/*">`, no `MediaRecorder` usage, no upload button.
- No `api/voice` route exists.
- `lib/providers/` has no transcription adapter.

Findings:
- Microphone recording: not implemented.
- Audio save/replay: not implemented.
- Transcription: not implemented.
- Persistence: not applicable.
- Security/permission/file-size checks: not applicable.

Smallest fix:
- Add `MediaRecorder` component in UI, upload route (`/api/voice/upload`), storage target (Supabase `bdm_voice_notes` or S3), transcription adapter (Whisper/OpenAI), replay component, and file-size/permission checks.

---

## C — Sourced Web Research (SearXNG)

Status: **Missing / Unverified.**

Evidence:
- `.env.example`: `BDM_WEB_SEARCH_ENABLED=true`; `.env.local`: `BDM_WEB_SEARCH_ENABLED=false`.
- `app/api/chat/route.ts`: no `searxng`, `fetch` to search endpoint, `search` parameter processing, or result injection into model context.
- `lib/agents/` (`MasterAgent`, `Orchestrator`, `Dispatcher`, `TaskManager`): no search/tool references.
- `lib/providers/openai.ts`: `supportsTools` set but no tool definitions or search invocation.
- `app/page.tsx`: no citation links, no source rendering component.
- `.env.local`: no `SEARXNG_URL` value shown (variable name missing from current file); no `SEARXNG_URL` reference found in source files.

Findings:
- `BDM_WEB_SEARCH_ENABLED` exists but is `false` and unused.
- No `SEARXNG_URL` variable present in `.env.local`.
- Search results not supplied to model.
- No response citations.
- No timeout/empty/malformed response handling for search.
- No validation that retrieved content is treated as untrusted input.

Smallest fix:
- Define `SEARXNG_URL` (or alternative search endpoint) in `.env`/`.env.local`.
- Add server-side `fetch` to search URL in `route.ts` or agent layer; validate URL; handle timeouts/empty/malformed responses.
- Pass results to model as context (not instructions).
- Add UI component for clickable citations.
- Add `.env.local` variable: confirm `BDM_WEB_SEARCH_ENABLED` and `SEARXNG_URL` names present (values not shown).

---

## System identification

- Database: Supabase (`supabase` directory, `lib/supabase.ts`, `.env.local` keys hidden)
- Auth: Anonymous fixed UUID (`ANONYMOUS_USER_ID` in `lib/conversations.ts`); no token-based auth
- Model provider: OpenAI (`lib/providers/openai.ts`) or Ollama (`lib/providers/ollama.ts`); `.env.local`: `BDM_DEFAULT_PROVIDER=ollama`, `OLLAMA_MODEL=gemma4:cloud`, `OPENAI_MODEL=gpt-5.6-luna`
- Search provider: None actively configured or called; `.env` variable `BDM_WEB_SEARCH_ENABLED` only

---

## Recommended implementation order

1. Persistent memory (`MemoryManager` DB persistence + user auth + UI controls)
2. Voice notes (recording + upload + storage + transcription adapter)
3. Sourced web research (`SEARXNG_URL` + server-side fetch + citation rendering + untrusted input handling)

---

## Tests / Deployment

- Existing test: `__tests__/health.test.ts` (only health endpoint)
- No memory, voice, or search feature tests.
- `docker-compose.yml` / `Dockerfile` present; Docker unavailable until reboot/WSL2 fix (not done in this session).

---

## Final note (no source changes made)

No application source files modified; `SETUP-WORKSTATION.md` updated with verified audit results only; no secrets exposed; `Ollama` prompt not interrupted; `Docker` unchanged; server smoke test confirmed (`HTTP 200`).
