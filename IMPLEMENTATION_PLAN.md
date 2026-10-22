# BDM-AI Upgrade — Implementation Plan

**Baseline established:** 346 tests passing, Next.js 16 + Supabase + Render deployment working.

---

## Phase 1 Complete: Repository Inspection

### Current Architecture Summary

| Area | Status | Key Files |
|------|--------|-----------|
| **Framework** | Next.js 16.4.1, React 19, TypeScript | `package.json`, `next.config.ts` |
| **Database** | Supabase (PostgreSQL) with RLS | `supabase/migrations/*.sql`, `lib/supabase*.ts` |
| **Auth** | Supabase Auth (email + Google OIDC) | `lib/auth.ts`, `app/auth/`, `lib/google-*.ts` |
| **AI Providers** | OpenAI / Ollama with fallback | `lib/ai.ts`, `app/api/chat/route.ts` |
| **Search** | Tavily / Brave / SearXNG | `lib/search.ts`, `app/api/research/route.ts` |
| **Memory** | **Implemented** (7 kinds, secret-safe, project-scoped) | `lib/memory-core.ts`, `lib/memory-store.ts`, `app/api/memories/*` |
| **Quotas** | Durable (Supabase RPC) + in-process burst | `lib/quota.ts`, `lib/rate-limit.ts` |
| **Email** | Resend with confirmation gate | `lib/email.ts`, `app/api/email/send/route.ts` |
| **Deployment** | Render free tier, auto-deploy on push | `render.yaml` |
| **UI** | MemoryPanel, SettingsClient, ResearchView | `app/components/MemoryPanel.tsx`, etc. |
| **Tests** | 346 passing (memory, chat, research, auth, etc.) | `tests/*.test.ts` |

### Memory System — Already Solid
- **7 kinds**: fact, preference, goal, project, person, instruction, summary
- **Safety**: Secret detection/redaction, credential refusal
- **Commands**: Explicit "remember this" / "forget this" parsing
- **Relevance**: Token-overlap scoring, pinned always-injected, project isolation
- **API**: Full CRUD with auth, project scoping, source conversation linking
- **UI**: Search, edit, pin, delete, clear all, clear history

---

## Phase 2 — Memory 2.0 Enhancements

### Gaps vs. Spec

| Feature | Current | Required | Effort |
|---------|---------|----------|--------|
| Validation (user-confirmed vs inferred) | ❌ | Distinguish confirmed/inferred/stale/superseded | Medium |
| Deduplication | ❌ | Detect repeated/contradictory entries | Medium |
| Compaction | ❌ | Summarize older conversations preserving decisions | Medium |
| Recovery checkpoints | ❌ | Reconstruct task state after restart | Medium |
| Provenance/timestamps/confidence | Partial (created_at, updated_at) | Add confidence, source, supersession chain | Low |
| Conflict resolution | ❌ | Conservative resolution, ask user on material conflict | Medium |
| Memory controls API | Partial (CRUD only) | Search, correct, mark outdated, inspect sources, see influence | Low |

### Implementation Tasks

**2A. Schema Extensions** (`supabase/migrations/0006_memory_20.sql`)
```sql
-- Add to bdm_memories:
confidence smallint check (confidence >= 0 and confidence <= 100) default 80,
source text check (source in ('user_explicit', 'inferred', 'imported')) default 'user_explicit',
superseded_by uuid references bdm_memories(id) on delete set null,
superseded_at timestamptz,
validation_status text check (validation_status in ('unvalidated', 'confirmed', 'disputed', 'stale')) default 'unvalidated',
```

**2B. Core Logic** (`lib/memory-core.ts`)
- `deduplicateMemories(memories: Memory[]): Memory[]` — merge near-duplicates, flag contradictions
- `compactMemories(memories: Memory[], projectKey?: string): Memory[]` — summarize old facts, preserve pinned/goals/instructions
- `resolveConflicts(memories: Memory[]): Memory[]` — conservative: keep both, mark disputed, require user resolution
- `classifyValidationStatus(memory: Memory): ValidationStatus` — heuristics + user confirmation tracking

**2C. Store Extensions** (`lib/memory-store.ts`)
- `supersedeMemory(userId, oldId, newContent, ...)` — create new, link old→new, mark old stale
- `validateMemory(userId, id, status)` — user marks confirmed/disputed
- `getMemoryProvenance(userId, id)` — return chain of supersessions

**2C. API Routes** (`app/api/memories/*`)
- `PATCH /api/memories/[id]/validate` — user confirms/disputes
- `POST /api/memories/deduplicate` — run dedup, return proposed merges for approval
- `POST /api/memories/compact` — run compaction on project/global, return summary for approval

**2D. UI** (`MemoryPanel.tsx`)
- Confidence indicator, source badge, validation status toggle
- "Resolve conflict" action when disputes exist
- "Compact project memories" button (admin action)

---

## Phase 3 — Task Execution System (NEW)

### Design

**Task State Machine:**
```
queued → planning → awaiting_approval → running → verifying → completed
                    ↓                    ↓
                 cancelled            failed → retry (bounded) → failed
```

**Task Schema** (`supabase/migrations/0007_tasks.sql`):
```sql
create table public.bdm_tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_key text,
  title text not null,
  description text,
  status text not null check (status in ('queued','planning','awaiting_approval','running','verifying','completed','failed','cancelled')) default 'queued',
  plan jsonb not null default '[]'::jsonb,        -- ordered steps with tool, args, expected_outcome
  current_step integer not null default 0,
  checkpoints jsonb not null default '[]'::jsonb, -- {step, output, verified_at}
  retry_count integer not null default 0,
  max_retries integer not null default 3,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create index bdm_tasks_user_idx on public.bdm_tasks (user_id, status, updated_at desc);
alter table public.bdm_tasks enable row level security;
-- RLS policies: user owns their tasks
```

**Core Service** (`lib/task-executor.ts`):
- `createTask(userId, project, title, description, plan, requiresApproval)`
- `startTask(taskId)` — transitions queued→planning→awaiting_approval/running
- `executeStep(taskId)` — runs current step, verifies, records checkpoint
- `verifyStep(taskId, stepIndex, expected, actual)` — independent verification
- `retryTask(taskId)` — bounded, idempotent for safe operations
- `cancelTask(taskId)` — graceful stop, persists state
- `resumeTask(taskId)` — from last verified checkpoint

**Step Definition:**
```typescript
interface TaskStep {
  id: string;
  description: string;
  tool: string;              // e.g., "filesystem.write", "browser.navigate", "supabase.query"
  args: Record<string, unknown>;
  expectedOutcome: string;   // verifiable condition
  idempotent: boolean;       // safe to retry
  requiresApproval: boolean;
  timeoutMs: number;
}
```

**API Routes** (`app/api/tasks/*`):
- `GET /api/tasks` — list with filters (status, project)
- `POST /api/tasks` — create (requires approval if any step requiresApproval)
- `GET /api/tasks/[id]` — full state + checkpoints
- `POST /api/tasks/[id]/start` — begin execution
- `POST /api/tasks/[id]/approve` — user approves awaiting_approval
- `POST /api/tasks/[id]/cancel` — cancel
- `POST /api/tasks/[id]/retry` — retry failed

**UI** (`TaskDashboard.tsx`, `TaskDetail.tsx`):
- Task list with status badges, progress bars
- Step-by-step execution view with live logs
- Approval queue with step details
- Retry/cancel actions

---

## Phase 4 — Environment Capabilities Inventory

### Current Integrations

| Capability | Status | Auth | Limits | Audit |
|------------|--------|------|--------|-------|
| Filesystem (read/write) | Via agent skill | Workspace root | No exec | ❌ |
| Terminal | Via agent skill | User context | Timeout | ❌ |
| Git | Via agent skill | Repo access | - | ❌ |
| Browser | agent-browser skill | Session cookies | 5min idle | ❌ |
| Search (Tavily/Brave) | `lib/search.ts` | API key | 15s timeout | ✅ |
| Supabase query | `lib/supabase-server.ts` | User session | RLS | ✅ |
| Render deploy | Render API | API key | - | ❌ |

### Tasks
**4A. Capability Registry** (`lib/capabilities.ts`)
```typescript
interface Capability {
  key: string;
  name: string;
  operations: string[];
  requiredPermission: 'read' | 'write' | 'admin';
  authMechanism: 'session' | 'api_key' | 'oauth';
  timeoutMs: number;
  rateLimit?: { windowMs: number; max: number };
  fallback: 'deny' | 'degrade' | 'ask';
}
```

**4B. Permission Enforcement** (integrate with `bdm_tool_permissions` table)
- Check `permission_level` ('deny'/'ask'/'allow') before each tool call
- Queue approval requests for 'ask' tools

**4C. Audit Logging** (use existing `bdm_audit_events`)
- Log every tool call with: user, tool, args (redacted), result status, duration

---

## Phase 5 — Safe Autonomy & Permissions

### Permission Levels (enforce existing `bdm_tool_permissions`)

| Level | Tools | Approval |
|-------|-------|----------|
| **READ** | search, list files, read logs, git status, inspect services | None |
| **REVERSIBLE** | create/edit project files, add tests, update docs, local git commits | Implicit (user initiated) |
| **EXTERNAL** | send email, post message, modify shared DB, change account settings | Explicit per-operation |
| **HIGH-IMPACT** | Production deploy, secret rotation, destructive ops, financial | Explicit + confirmation |

### Implementation
- `lib/permissions.ts` — `checkPermission(userId, toolKey): 'allow' | 'ask' | 'deny'`
- Middleware/guard in each API route and task executor step
- Approval queue UI with expiration (24h default)

---

## Phase 6 — Project Awareness

### Schema (`supabase/migrations/0008_projects.sql`)
```sql
create table public.bdm_projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  key text not null,                    -- e.g., "bdm-ai", "city-gate"
  name text not null,
  workspace_root text,                  -- authorized filesystem root
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, key)
);

-- Extend bdm_tasks, bdm_memories with project_id FK (optional, metadata.project kept for compat)
```

### Resolver
- `resolveProject(userId, keyOrId)` — validates access, returns project config
- Every task/memory/tool call requires explicit project resolution

---

## Phase 7 — Improved Reasoning & Context

### Additions to `lib/ai.ts` / new `lib/planning.ts`
- `planTask(goal, context, availableTools): TaskPlan` — decompose into ordered steps
- `selectContext(task, memories, conversationHistory): ContextPackage` — relevant only
- `verifyResult(step, actualOutput): VerificationResult` — independent check
- `replan(task, failedStep, error): TaskPlan` — alternative approach

### Context Budgets
- Configurable limits: `MAX_CONTEXT_TOKENS`, `MAX_TOOL_CALLS_PER_TASK`, `MAX_TASK_DURATION_MS`
- Enforced in task executor, surfaced in UI

---

## Phase 8 — UI Upgrades

### New Components
1. **TaskDashboard** — list, filter, create, bulk actions
2. **TaskDetail** — step timeline, live logs, approve/retry/cancel
3. **ApprovalQueue** — pending approvals with step details
4. **CapabilitiesPanel** — tool status, permissions, health
5. **ProjectSelector** — header dropdown, persists in localStorage

### Integration
- Add to `SettingsClient.tsx` or new `/dashboard` route
- Use existing royal-blue/gold design tokens from `premium.css` / `dashboard.css`

---

## Phase 9 — Tests & Regression

### New Test Files
| File | Coverage |
|------|----------|
| `tests/task-executor.test.ts` | Plan, execute, persist, resume, cancel, retry, verify |
| `tests/permissions.test.ts` | Unauthorized denied, workspace boundaries, secret redaction |
| `tests/memory-20.test.ts` | Dedup, compaction, conflict, validation, provenance |
| `tests/project-isolation.test.ts` | Project boundaries, cross-project denial |

### Run Command
```bash
npm run verify  # typecheck + lint + test + build
```

---

## Phase 10 — Delivery Stages

| Stage | Deliverable | Approval Required |
|-------|-------------|-------------------|
| **A** | Baseline report (this doc) | ✅ Done |
| **B** | Memory 2.0 schema + core + store + API | ❌ DB migration |
| **C** | Memory retrieval + context assembly + UI | ❌ |
| **D** | Task executor + recovery + API + UI | ❌ DB migration |
| **E** | Permission controls + audit events | ❌ |
| **F** | Capability registry + tool integration | ❌ |
| **G** | Dashboard UI + settings | ❌ |
| **H** | Regression tests + e2e verification | ❌ |
| **I** | Deploy prep (migrations, env docs) | ❌ Production deploy |

---

## Database Migrations Required

1. `0006_memory_20.sql` — Memory enhancements (confidence, source, supersession, validation)
2. `0007_tasks.sql` — Task execution system
3. `0008_projects.sql` — Project registry

**All migrations are additive, idempotent, and RLS-protected. No destructive changes.**

---

## Environment Variables (New)

| Key | Purpose | Required |
|-----|---------|----------|
| `BDM_MAX_CONTEXT_TOKENS` | Context budget (default 8000) | No |
| `BDM_MAX_TOOL_CALLS_PER_TASK` | Tool call ceiling (default 20) | No |
| `BDM_MAX_TASK_DURATION_MS` | Task timeout (default 300000) | No |
| `BDM_APPROVAL_EXPIRY_HOURS` | Approval TTL (default 24) | No |

---

## Security Considerations

- ✅ All new tables use RLS with `auth.uid() = user_id`
- ✅ Service role only for server-only tables (audit, google identities)
- ✅ Secrets never in memory (existing `containsSecret` gate)
- ✅ Tool permissions enforce least privilege
- ✅ Browser/external content treated as untrusted (existing research prompts)
- ✅ No automatic production deploy — manual trigger only

---

## Features Remaining Incomplete (Post-Launch)

- Vector/semantic search for memories (requires pgvector, cost evaluation)
- Multi-agent delegation (spec Phase 6, optional)
- Cross-project memory sharing (explicit user action only)
- Real-time collaboration on tasks (websockets)

---

## Next Action

**Request approval for Stage B** — Memory 2.0 schema migration (`0006_memory_20.sql`) and core logic implementation. This is the only database change needed for the memory upgrades and is backward-compatible.