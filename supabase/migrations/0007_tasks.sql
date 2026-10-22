/*
  Task Execution System — bdm_tasks table and supporting schema.
  
  Implements a durable task state machine with checkpoints, bounded retries,
  and idempotency guarantees. RLS enforces per-user ownership.
*/

-- Enable pgcrypto for gen_random_uuid() if not already present.
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- bdm_tasks: persistent task state machine
-- ---------------------------------------------------------------------------
create table if not exists public.bdm_tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  project_key text,
  title text not null,
  description text,
  status text not null check (status in (
    'queued', 'planning', 'awaiting_approval', 'running', 'verifying',
    'completed', 'failed', 'cancelled'
  )) default 'queued',
  plan jsonb not null default '[]'::jsonb,
  current_step integer not null default 0,
  checkpoints jsonb not null default '[]'::jsonb,
  retry_count integer not null default 0,
  max_retries integer not null default 3,
  error text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists bdm_tasks_user_idx
  on public.bdm_tasks (user_id, status, updated_at desc);

create index if not exists bdm_tasks_project_idx
  on public.bdm_tasks (user_id, project_key, status);

alter table public.bdm_tasks enable row level security;

drop policy if exists "bdm_tasks_select_own" on public.bdm_tasks;
create policy "bdm_tasks_select_own"
  on public.bdm_tasks for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "bdm_tasks_insert_own" on public.bdm_tasks;
create policy "bdm_tasks_insert_own"
  on public.bdm_tasks for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "bdm_tasks_update_own" on public.bdm_tasks;
create policy "bdm_tasks_update_own"
  on public.bdm_tasks for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "bdm_tasks_delete_own" on public.bdm_tasks;
create policy "bdm_tasks_delete_own"
  on public.bdm_tasks for delete
  to authenticated
  using (auth.uid() = user_id);

comment on table public.bdm_tasks is
  'Persistent task execution state. RLS: authenticated users access own tasks only.';

-- ---------------------------------------------------------------------------
-- bdm_task_steps: individual step execution records (audit trail)
-- ---------------------------------------------------------------------------
create table if not exists public.bdm_task_steps (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.bdm_tasks (id) on delete cascade,
  step_index integer not null,
  tool_key text not null,
  args jsonb not null default '{}'::jsonb,
  expected_outcome text,
  status text not null check (status in ('pending', 'running', 'completed', 'failed', 'skipped')) default 'pending',
  result jsonb,
  error text,
  started_at timestamptz,
  completed_at timestamptz,
  duration_ms integer,
  retry_count integer not null default 0,
  idempotent boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists bdm_task_steps_task_idx
  on public.bdm_task_steps (task_id, step_index);

alter table public.bdm_task_steps enable row level security;

drop policy if exists "bdm_task_steps_select_own" on public.bdm_task_steps;
create policy "bdm_task_steps_select_own"
  on public.bdm_task_steps for select
  to authenticated
  using (
    exists (
      select 1 from public.bdm_tasks t
      where t.id = bdm_task_steps.task_id
        and t.user_id = auth.uid()
    )
  );

drop policy if exists "bdm_task_steps_insert_own" on public.bdm_task_steps;
create policy "bdm_task_steps_insert_own"
  on public.bdm_task_steps for insert
  to authenticated
  with check (
    exists (
      select 1 from public.bdm_tasks t
      where t.id = bdm_task_steps.task_id
        and t.user_id = auth.uid()
    )
  );

drop policy if exists "bdm_task_steps_update_own" on public.bdm_task_steps;
create policy "bdm_task_steps_update_own"
  on public.bdm_task_steps for update
  to authenticated
  using (
    exists (
      select 1 from public.bdm_tasks t
      where t.id = bdm_task_steps.task_id
        and t.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.bdm_tasks t
      where t.id = bdm_task_steps.task_id
        and t.user_id = auth.uid()
    )
  );

comment on table public.bdm_task_steps is
  'Per-step execution audit trail. RLS: authenticated users access steps of own tasks only.';

-- ---------------------------------------------------------------------------
-- bdm_task_approvals: approval queue for steps requiring human confirmation
-- ---------------------------------------------------------------------------
create table if not exists public.bdm_task_approvals (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.bdm_tasks (id) on delete cascade,
  step_index integer not null,
  tool_key text not null,
  args jsonb not null default '{}'::jsonb,
  expected_outcome text,
  status text not null check (status in ('pending', 'approved', 'rejected', 'expired')) default 'pending',
  requested_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references auth.users (id) on delete set null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists bdm_task_approvals_task_idx
  on public.bdm_task_approvals (task_id, status);

create index if not exists bdm_task_approvals_pending_idx
  on public.bdm_task_approvals (status, expires_at)
  where status = 'pending';

alter table public.bdm_task_approvals enable row level security;

drop policy if exists "bdm_task_approvals_select_own" on public.bdm_task_approvals;
create policy "bdm_task_approvals_select_own"
  on public.bdm_task_approvals for select
  to authenticated
  using (
    exists (
      select 1 from public.bdm_tasks t
      where t.id = bdm_task_approvals.task_id
        and t.user_id = auth.uid()
    )
  );

drop policy if exists "bdm_task_approvals_update_own" on public.bdm_task_approvals;
create policy "bdm_task_approvals_update_own"
  on public.bdm_task_approvals for update
  to authenticated
  using (
    exists (
      select 1 from public.bdm_tasks t
      where t.id = bdm_task_approvals.task_id
        and t.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.bdm_tasks t
      where t.id = bdm_task_approvals.task_id
        and t.user_id = auth.uid()
    )
  );

comment on table public.bdm_task_approvals is
  'Approval queue for task steps requiring human confirmation. RLS: authenticated users access approvals for own tasks only.';