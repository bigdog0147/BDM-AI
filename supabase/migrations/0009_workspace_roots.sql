/*
  Workspace Roots — Authorized filesystem roots per user.
  
  Allows users to configure which directories the agent can access.
  Enforced by lib/workspace-bounds.ts on every filesystem operation.
*/

-- Enable pgcrypto for gen_random_uuid() if not already present.
create extension if not exists pgcrypto;

create table if not exists public.bdm_workspace_roots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  path text not null,                    -- Absolute path on the server
  description text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, path)
);

alter table public.bdm_workspace_roots enable row level security;

drop policy if exists "bdm_workspace_roots_select_own" on public.bdm_workspace_roots;
create policy "bdm_workspace_roots_select_own"
  on public.bdm_workspace_roots for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "bdm_workspace_roots_insert_own" on public.bdm_workspace_roots;
create policy "bdm_workspace_roots_insert_own"
  on public.bdm_workspace_roots for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "bdm_workspace_roots_update_own" on public.bdm_workspace_roots;
create policy "bdm_workspace_roots_update_own"
  on public.bdm_workspace_roots for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "bdm_workspace_roots_delete_own" on public.bdm_workspace_roots;
create policy "bdm_workspace_roots_delete_own"
  on public.bdm_workspace_roots for delete
  to authenticated
  using (auth.uid() = user_id);

create index if not exists bdm_workspace_roots_user_idx
  on public.bdm_workspace_roots (user_id, active);

comment on table public.bdm_workspace_roots is
  'Authorized filesystem roots per user. RLS: authenticated users manage own roots only.';