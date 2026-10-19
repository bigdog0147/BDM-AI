/*
  BDM foundation schema (local + hosted compatible).

  Mirrors the live hosted project lensupaeopgogulfkxar, verified against a
  schema dump on 2026-10-14. Row Level Security enforces per-user ownership
  on every table; the app only ever uses the publishable (anon) key, so all
  access is governed by these policies. Idempotent (IF NOT EXISTS / DROP IF
  EXISTS before create) so it is safe to re-apply.

  This file is the source of truth for the BDM data model. It is written to
  be applied both to a fresh local Supabase stack and (by you, with explicit
  approval) to the hosted project.
*/

-- Enable pgcrypto for gen_random_uuid() if not already present.
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Profiles: one row per authenticated user.
-- ---------------------------------------------------------------------------
create table if not exists public.bdm_profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  preferred_name text,
  timezone text,
  locale text not null default 'en-US',
  personality jsonb not null default '{}'::jsonb,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.bdm_profiles enable row level security;

drop policy if exists "bdm_profiles_select_own" on public.bdm_profiles;
create policy "bdm_profiles_select_own"
  on public.bdm_profiles for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "bdm_profiles_insert_own" on public.bdm_profiles;
create policy "bdm_profiles_insert_own"
  on public.bdm_profiles for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "bdm_profiles_update_own" on public.bdm_profiles;
create policy "bdm_profiles_update_own"
  on public.bdm_profiles for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Conversations: chat threads owned by a user.
-- ---------------------------------------------------------------------------
create table if not exists public.bdm_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text,
  model_hint text,
  metadata jsonb not null default '{}'::jsonb,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists bdm_conversations_user_idx
  on public.bdm_conversations (user_id, updated_at desc);

alter table public.bdm_conversations enable row level security;

drop policy if exists "bdm_conversations_select_own" on public.bdm_conversations;
create policy "bdm_conversations_select_own"
  on public.bdm_conversations for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "bdm_conversations_insert_own" on public.bdm_conversations;
create policy "bdm_conversations_insert_own"
  on public.bdm_conversations for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "bdm_conversations_update_own" on public.bdm_conversations;
create policy "bdm_conversations_update_own"
  on public.bdm_conversations for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "bdm_conversations_delete_own" on public.bdm_conversations;
create policy "bdm_conversations_delete_own"
  on public.bdm_conversations for delete
  to authenticated
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Messages: turns within a conversation. Access flows through the parent
-- conversation's ownership.
-- ---------------------------------------------------------------------------
create table if not exists public.bdm_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.bdm_conversations (id) on delete cascade,
  role text not null check (role in ('system', 'user', 'assistant', 'tool')),
  content jsonb,
  model text,
  tool_name text,
  tool_call_id text,
  token_usage jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists bdm_messages_conversation_idx
  on public.bdm_messages (conversation_id, created_at);

alter table public.bdm_messages enable row level security;

drop policy if exists "bdm_messages_select_own" on public.bdm_messages;
create policy "bdm_messages_select_own"
  on public.bdm_messages for select
  to authenticated
  using (
    exists (
      select 1 from public.bdm_conversations c
      where c.id = bdm_messages.conversation_id
        and c.user_id = auth.uid()
    )
  );

drop policy if exists "bdm_messages_insert_own" on public.bdm_messages;
create policy "bdm_messages_insert_own"
  on public.bdm_messages for insert
  to authenticated
  with check (
    exists (
      select 1 from public.bdm_conversations c
      where c.id = bdm_messages.conversation_id
        and c.user_id = auth.uid()
    )
  );

drop policy if exists "bdm_messages_update_own" on public.bdm_messages;
create policy "bdm_messages_update_own"
  on public.bdm_messages for update
  to authenticated
  using (
    exists (
      select 1 from public.bdm_conversations c
      where c.id = bdm_messages.conversation_id
        and c.user_id = auth.uid()
    )
  );

drop policy if exists "bdm_messages_delete_own" on public.bdm_messages;
create policy "bdm_messages_delete_own"
  on public.bdm_messages for delete
  to authenticated
  using (
    exists (
      select 1 from public.bdm_conversations c
      where c.id = bdm_messages.conversation_id
        and c.user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- Memories: long-term facts the assistant retains for a user.
-- ---------------------------------------------------------------------------
create table if not exists public.bdm_memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (
    kind in ('fact', 'preference', 'goal', 'project', 'person', 'instruction', 'summary')
  ),
  content text not null,
  importance integer not null default 50 check (importance >= 0 and importance <= 100),
  source_conversation_id uuid references public.bdm_conversations (id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  pinned boolean not null default false,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists bdm_memories_user_idx
  on public.bdm_memories (user_id, importance desc);

alter table public.bdm_memories enable row level security;

drop policy if exists "bdm_memories_select_own" on public.bdm_memories;
create policy "bdm_memories_select_own"
  on public.bdm_memories for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "bdm_memories_insert_own" on public.bdm_memories;
create policy "bdm_memories_insert_own"
  on public.bdm_memories for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "bdm_memories_update_own" on public.bdm_memories;
create policy "bdm_memories_update_own"
  on public.bdm_memories for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "bdm_memories_delete_own" on public.bdm_memories;
create policy "bdm_memories_delete_own"
  on public.bdm_memories for delete
  to authenticated
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Knowledge items: documents / references with citation support.
-- ---------------------------------------------------------------------------
create table if not exists public.bdm_knowledge_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  source_type text not null,
  title text not null,
  source_uri text,
  content text not null,
  citation text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists bdm_knowledge_items_user_idx
  on public.bdm_knowledge_items (user_id, created_at desc);

alter table public.bdm_knowledge_items enable row level security;

drop policy if exists "bdm_knowledge_items_select_own" on public.bdm_knowledge_items;
create policy "bdm_knowledge_items_select_own"
  on public.bdm_knowledge_items for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "bdm_knowledge_items_insert_own" on public.bdm_knowledge_items;
create policy "bdm_knowledge_items_insert_own"
  on public.bdm_knowledge_items for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "bdm_knowledge_items_update_own" on public.bdm_knowledge_items;
create policy "bdm_knowledge_items_update_own"
  on public.bdm_knowledge_items for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "bdm_knowledge_items_delete_own" on public.bdm_knowledge_items;
create policy "bdm_knowledge_items_delete_own"
  on public.bdm_knowledge_items for delete
  to authenticated
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Audit events: immutable-ish log of significant actions.
-- ---------------------------------------------------------------------------
create table if not exists public.bdm_audit_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  event_type text not null,
  action text not null,
  status text not null,
  conversation_id uuid,
  tool_key text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists bdm_audit_events_user_idx
  on public.bdm_audit_events (user_id, created_at desc);

alter table public.bdm_audit_events enable row level security;

drop policy if exists "bdm_audit_events_select_own" on public.bdm_audit_events;
create policy "bdm_audit_events_select_own"
  on public.bdm_audit_events for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "bdm_audit_events_insert_own" on public.bdm_audit_events;
create policy "bdm_audit_events_insert_own"
  on public.bdm_audit_events for insert
  to authenticated
  with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Tool permissions: per-user allow/ask/deny for each tool key.
-- ---------------------------------------------------------------------------
create table if not exists public.bdm_tool_permissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  tool_key text not null,
  permission_level text not null check (permission_level in ('deny', 'ask', 'allow')),
  updated_at timestamptz not null default now(),
  unique (user_id, tool_key)
);

alter table public.bdm_tool_permissions enable row level security;

drop policy if exists "bdm_tool_permissions_select_own" on public.bdm_tool_permissions;
create policy "bdm_tool_permissions_select_own"
  on public.bdm_tool_permissions for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "bdm_tool_permissions_insert_own" on public.bdm_tool_permissions;
create policy "bdm_tool_permissions_insert_own"
  on public.bdm_tool_permissions for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "bdm_tool_permissions_update_own" on public.bdm_tool_permissions;
create policy "bdm_tool_permissions_update_own"
  on public.bdm_tool_permissions for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "bdm_tool_permissions_delete_own" on public.bdm_tool_permissions;
create policy "bdm_tool_permissions_delete_own"
  on public.bdm_tool_permissions for delete
  to authenticated
  using (auth.uid() = user_id);
