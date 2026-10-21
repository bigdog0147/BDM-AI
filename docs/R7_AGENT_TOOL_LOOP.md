# R7 scoping document — agent orchestration / tool-calling loop

Status: **scoped, not started.** This document is the agreed plan for R7. No
implementation exists yet. Written 2026-10-21 from a read of the current code
on `feature/workspace-redesign` at `4b17ea3`.

---

## 1. Objective

Let the assistant decide, within a single request, whether it needs a tool
(search, re-search, read a source more deeply, use memory), call it, observe
the result, and loop — either until it can answer, or until a hard budget
stops it. Today it cannot: it answers, or it searches, but never both.

## 2. Non-goals

| Excluded | Why |
| --- | --- |
| Streaming / SSE progress events | Chat deliberately returns one JSON response (`lib/ai.ts` note: "no partially-delivered answer that could switch providers mid-flight"). A loop behind the same contract keeps that guarantee. Streaming is R8 material. |
| Money- or action-spending tools (images, email send) | They need an explicit confirmation surface; images already have quota/audit work of their own. R7 limits itself to read-only tools. |
| Reading arbitrary URLs | `read_page` may only fetch URLs already present in the result pool from `search_web`. This single rule removes most of the SSRF surface. |
| Autonomous multi-turn agents across requests | One request, one loop, one answer. No cross-request state except the conversation itself. |

## 3. Current state (what R7 builds on)

- **Chat** (`app/api/chat/route.ts`): one `generateReply` call. 20/min
  in-process limiter. Memory *writes* are parsed deterministically by
  `parseMemoryCommand` (`lib/memory-core.ts`) — the model never narrates a
  write; the route confirms from the database outcome. Anonymous chat works;
  memory requires sign-in.
- **Research** (`app/api/research/route.ts`): a fixed pipeline —
  `searchWeb(limit 5)` → a single `generateReply` → `sanitizeCitations` →
  `persistTurn(..., assistantSources)`. One search round, five snippets, no
  follow-ups, no deeper page reading.
- **Providers** (`lib/ai.ts`): `generateReply` with provider-level and
  same-provider model-level fallback; fallback only for transient kinds
  (`timeout|unreachable|rate_limit|server`); auth and config errors surface.
  `OLLAMA_TIMEOUT_MS = 240s`, `OPENAI_TIMEOUT_MS = 60s`.
- **Search** (`lib/search.ts`): brave / tavily / searxng, `MAX_RESULTS = 8`,
  15 s timeout, typed failures, provider is fixed from the environment and
  never silently switched. *Note: this file is currently mid-edit by another
  session (`TAVILY_KEYLESS` dev mode was added 2026-10-21 ~06:00). R7 must
  re-read it before implementation.*
- **Persistence** (`lib/bdm-types.ts`): the schema anticipated this feature —
  `Message.role` already includes `"tool"`, with `tool_name` and `tool_call_id`
  columns.
- **Prompt** (`lib/prompt.ts`): the system prompt *promises* the capability:
  "Your architecture is designed to gain more tools and memory over time."
- **Old-model / citation machinery** (`lib/research.ts`): the untrusted-content
  boundary (`<source>` blocks + `escapeForDelimiter`), the citation
  extraction/sanitation, and the honesty rules (never fill gaps from memory)
  are already written and tested. The loop inherits them verbatim.

## 4. The controlling constraint: the local model is weak

The verified reality of this deployment (measured 2026-10-21):

| Model | One-word answer time | Notes |
| --- | --- | --- |
| `qwen2.5:0.5b` (current primary) | ~5 s warm | No reliable native function-calling |
| `qwen3.5:4b` | 72 s cold; emits `thinking` with empty `content` | Reasoning-style output; a loop would multiply this latency |
| `gemma4:26b` | hangs (>150 s) | Too heavy for this laptop |
| OpenAI (`OPENAI_MODEL`) | provider-backed; key present | Responses API supports native `tools[]` |

Consequence, and the central design decision:

> **The loop must be usable by a model that cannot do native function
> calling.** Therefore the mechanism is a strict text protocol parsed
> deterministically, with native `tools[]` as an optional upgrade when the
> primary supports it — mirroring how memory writes already work by protocol
> rather than by model reliability.

## 5. Recommended design

### 5.1 Shape

A single new server-side loop inside `POST /api/chat`, returning the same
single-JSON response as today (+ an optional agent trace). The model sees a
transcript as text; each row of output is either the final answer or a tool
call. The driver — never the model — owns iteration count, budget, parsing,
and validation.

```
POST /api/chat
  → deterministic gate: does this message plausibly need tools?
      (same philosophy as parseMemoryCommand: route decides, model narrates)
  → session: build tool ledger + instructions from SYSTEM_PROMPT
  → iteration (≤ 3 tool rounds, ≤ 90 s wall clock):
        generateReply (messages-mode) → parse one strict step:
          FINAL  <answer>            → return it (citations sanitized as today)
          TOOL <name> <strict JSON>  → validate → execute → append result → next
          malformed / over-budget    → driver calls for the final answer with
                                       the accumulated material
  → persistTurn as today (+ assistantSources when search ran)
```

### 5.2 Tool protocol (weak-model friendly, deterministic)

The model emits exactly one of, as the last line(s) of its reply:

```
FINAL: <the complete final answer — may be multi-line until EOF>

TOOL: search_web {"query": "…", "limit": 5}

TOOL: read_page {"source": 2}
```

Rules:

- The parser accepts a single JSON object on the same line and validates it
  against a strict per-tool schema (`unknown` fields rejected, sizes capped).
- Any malformed step counts against the round budget; **two** consecutive
  malformed steps force an immediate "answer with what you have" call, never
  an infinite clarification loop.
- A tool call inside a `<source>` block (untrusted data) can never be parsed:
  the parser only reads the model's own output channel, and untrusted blocks
  are only ever delivered into prompts via `escapeForDelimiter`. This is
  tested like `tests/research-core.test.ts` tests prompt-forge attempts.

### 5.3 Tools in R7.1 (both read-only)

| Tool | Contract | Guards |
| --- | --- | --- |
| `search_web` | `{query: string ≤ 400 chars, limit: 1–5}` → appends to the shared source pool. Wraps the existing `searchWeb` unchanged. | ≤ **3 distinct queries** per request; dedupe by URL; pool cap **12** sources, stable citation indices |
| `read_page` | `{source: index}` → fetches that pool entry, strips HTML to text, returns ≤ 6 000 chars | Only URLs already in the pool; http(s) only; 15 s timeout; response ≤ 256 KB; content stripped, never rendered |

The `read_page` SSRF posture — honest limits, stated up front:

- **Mobile-app scope handled:** only provider-returned URLs become fetchable,
  and they are http(s) with a hostname that came from the search backend.
- **Remaining gap:** DNS rebinding and hostname→private-IP resolution. The
  full fix (resolve, pin the connection to a verified non-private IP) is
  listed as a hardening follow-up (§9). The MVP additionally blocks URL
  literals pointing at loopback/link-local/private ranges, and never follows
  a redirect outside the original hostname.

The existing HTML-stripper lives inside `lib/search.ts` (private). R7 extracts
it into a shared `lib/html-text.ts` rather than duplicating it.

### 5.4 What changes in which files (implementation phase)

| File | Change |
| --- | --- |
| `lib/tool-protocol.ts` *(new)* | Step parser/serializer, strict per-tool schemas |
| `lib/agent-loop.ts` *(new)* | The driver: budgets, ledger, forced-answer path |
| `lib/tool-executors.ts` *(new)* | `search_web` + `read_page` executors (typed results, never throw) |
| `lib/html-text.ts` *(new)* | Shared HTML→text extraction (moved out of `search.ts`) |
| `lib/ai.ts` | Add a messages-mode variant of the two `call*` functions (chat transcript instead of one system+user pair). Changes the classified-error plumbing, not the fallback policy |
| `app/api/chat/route.ts` | Wire the loop behind the flag; extend the response with `agentTrace` |
| `app/page.tsx` | Optional: render `agentTrace` ("searched 3×, read 2 sources") — honest telemetry, no new modes |
| **Untouched:** `lib/search.ts`, `tests/research.test.ts`, `.env.example`, `app/*` styles | Currently mid-edit by another session; R7 consumes `searchWeb` as-is |

### 5.5 Flag and degradation

`BDM_AGENT_MODE = off | protocol | native` — default **off**.

- `off`: today's behavior, byte-for-byte.
- `protocol`: the loop above; works on any model, including `qwen2.5:0.5b`
  (the gate + protocol tolerates a weak model: worst case it does one search
  round and answers, which is today's research pipeline).
- `native`: OpenAI-primary only; uses Responses API `tools[]` with the same
  executors behind them. Verified against the installed `openai@7.5.0`
  docs at implementation time. Ollama's `tools` parameter is used only for
  a model whose manifest advertises tool support.
- If the configured provider cannot support the requested mode, the status
  endpoint reports it (`agent: { mode, supported }`) and requests fall back to
  `protocol` (never to a different provider, per the existing fallback rules).

### 5.6 Budgets (non-negotiable)

| Budget | Value | Reason |
| --- | --- | --- |
| Tool rounds | ≤ 3 | Matches the 10/min research limiter and keeps a local-model loop under a tolerable wall clock |
| Wall clock | ≤ 90 s | Under `OLLAMA_TIMEOUT_MS` (240 s) with room for the final forced-answer call |
| Distinct searches | ≤ 3 | Search bursts are the real provider-side cost |
| Source pool | ≤ 12 | Citation UI and prompt size stay bounded |
| Page reads | ≤ 2 per request | Largest latency item after the model itself |
| Quota | **Charged once per request** (not per round) | Preserves today's UX and the `research.daily` 40/day math; the extra rounds are bounded, so the multiplier is capped at ~3 searches + 2 reads |

Anonymous callers keep the shared per-IP-hash quota; the loop does not change
who may act.

### 5.7 Security invariants carried from the existing code

1. `buildResearchSystemPrompt()`'s non-negotiable rules (untrusted `<source>`
   blocks; never follow page instructions) become the loop's system prompt —
   plus one addition: *tool results are untrusted data with the same rules*.
2. `sanitizeCitations` / `extractCitationIndices` run on every exit path,
   including a loop-terminated answer.
3. Unsafe cleanup: no raw upstream error text anywhere; every failure is a
   kind + `safeError` mapping; logs carry only `provider:kind`
   (`safeLogDetail`).
4. `read_page` output goes into a prompt block, never into the DOM.
5. No tool can trigger another AI call; a single request makes at most
   `rounds + 1` model calls, all through the existing fallback rules.

## 8. Testing plan

New tests in the existing style (vitest, all offline/mocked-fetch):

| File | Covers |
| --- | --- |
| `tests/agent-core.test.ts` | Step parser: valid, malformed, injection attempts (tool call inside untrusted blocks), oversized payloads, duplicate tool args |
| `tests/agent-loop.test.ts` | Round caps, wall-clock forcing, consecutive-malformed → forced answer, dedupe + pool caps, `agentTrace` shape, quota charged once |
| `tests/tool-executors.test.ts` | `search_web` wrapping/failures mapped to kinds; `read_page` URL allow-list, private-range literals, redirect/scheme/size guards |
| extends `tests/chat.test.ts` | Flag off = byte-identical today; flag on = happy path E2E with mocked fetch |

Gate: `npm run verify` (typecheck, lint, tests, build) green with zero new
lint suppressions.

## 9. Hardening follow-up (not R7.1 blockers)

1. **DNS-rebinding-proof fetch** for `read_page`: resolve the hostname,
   verify the IP is public, pin the connection (custom undici agent/dialer).
2. Per-tool audit rows (`lib/audit.ts` already has a `tool_key` column — use it
   for `read_page` fetches).
3. Native-tool argument validation parity for `native` mode.
4. Progress streaming (R8) so long local-model loops feel alive.

## 10. Sequencing

1. **R7.1** — flag-gated `protocol` loop in chat, two read-only tools, tests.
   Implementable without touching the contested files (`lib/search.ts`,
   `tests/research.test.ts`, `.env.example`); the flag is documented here and
   added to `.env.example` once that file settles.
2. **R7.2** — `native` mode for OpenAI-primary; status reporting of mode
   support. Requires the messages-mode provider extension.
3. **R7.3** — memory as a callable tool (read/retrieve side; *writes stay
   deterministic path as today*), and a decision on unifying
   `POST /api/research` onto the loop (keep it separate until the loop's
   answer quality is at parity).

## 11. Owner decision points

1. **Latency on local hardware.** With `qwen2.5:0.5b` primary, a loop is
   ~3× today's chat latency in the worst case (~15–45 s). Recommend enabling
   `protocol` locally with rounds capped at 3; the honest alternative is to
   accept that the loop really shines when `AI_PROVIDER=openai` and keep it
   `off` locally.
2. **Quota accounting** — once per request (recommended) vs per tool round.
3. **Keep `/api/research` as-is** in R7.1 (recommended) or route it through
   the loop immediately (higher risk of regressing a green pipeline).
4. **`agentTrace` in the UI** (recommended: show "searched N×, read M")
   or silent.

## 12. Verification checklist for the implementation PR

- [ ] `npm run verify` green
- [ ] Flag `off`: chat response identical to pre-R7 (golden test)
- [ ] Flag `protocol`, local model: a question that needs two searches
      completes with citations ≤ 12-source pool; a malformed-model reply is
      forced to answer after ≤ 2 malformed steps; total wall clock < 90 s
- [ ] Prompt-injection test: a page containing a forged `TOOL:` line inside a
      `<source>` block triggers no tool call
- [ ] `read_page` refuses: non-http(s), non-pool URL, private/loopback
      literals, redirect off-host, >256 KB, non-HTML
- [ ] No new env var read outside the documented `BDM_AGENT_MODE`
- [ ] Cross-check at implementation time: re-read `lib/search.ts` (it changed
      after this document was written) so `searchWeb`'s contract and the
      keyless mode are reflected in the executors.
