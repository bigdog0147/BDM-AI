/*
  Memory 2.0 — Enhancements to bdm_memories table.
  
  Adds validation tracking, supersession chains, confidence scoring,
  and explicit source attribution. All columns are nullable with
  sensible defaults so existing rows remain valid without a backfill.
*/

-- Enable pgcrypto for gen_random_uuid() if not already present.
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- bdm_memories: new columns for Memory 2.0
-- ---------------------------------------------------------------------------
alter table if exists public.bdm_memories
  add column if not exists confidence smallint
    check (confidence >= 0 and confidence <= 100)
    default 80;

alter table if exists public.bdm_memories
  add column if not exists source text
    check (source in ('user_explicit', 'inferred', 'imported'))
    default 'user_explicit';

alter table if exists public.bdm_memories
  add column if not exists superseded_by uuid
    references public.bdm_memories(id) on delete set null;

alter table if not exists public.bdm_memories
  add column if not exists superseded_at timestamptz;

alter table if not exists public.bdm_memories
  add column if not exists validation_status text
    check (validation_status in ('unvalidated', 'confirmed', 'disputed', 'stale'))
    default 'unvalidated';

-- Helpful index for supersession chains
create index if not exists bdm_memories_superseded_by_idx
  on public.bdm_memories (superseded_by);

-- Index for validation status filtering
create index if not exists bdm_memories_validation_idx
  on public.bdm_memories (user_id, validation_status, updated_at desc);

-- Comment for documentation
comment on column public.bdm_memories.confidence is
  'Confidence score 0-100. User-explicit memories default 80; inferred lower.';

comment on column public.bdm_memories.source is
  'Origin of the memory: user_explicit (remember command), inferred (agent deduction), imported (bulk).';

comment on column public.bdm_memories.superseded_by is
  'Points to the memory that replaces this one. Forms a chain; the head has superseded_by = null.';

comment on column public.bdm_memories.superseded_at is
  'Timestamp when this memory was marked superseded.';

comment on column public.bdm_memories.validation_status is
  'unvalidated = never reviewed, confirmed = user approved, disputed = user flagged incorrect, stale = superseded or outdated.';

-- Ensure RLS is still enabled (idempotent)
alter table public.bdm_memories enable row level security;