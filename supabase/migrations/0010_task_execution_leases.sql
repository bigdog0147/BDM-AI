/*
  Atomic task execution claim foundation.

  Adds task-step claim metadata to bdm_tasks and a database-callable function
  that atomically claims a step under a lease. This is the first concurrency
  control layer for task execution.

  The claim function is security invoker and relies on existing RLS ownership
  policies. Worker identity is diagnostic only; execution_id is the token.
*/

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Task execution lease fields
-- ---------------------------------------------------------------------------
alter table public.bdm_tasks
  add column if not exists execution_id uuid;

alter table public.bdm_tasks
  add column if not exists lease_owner text;

alter table public.bdm_tasks
  add column if not exists lease_expires_at timestamptz;

alter table public.bdm_tasks
  add column if not exists lease_generation bigint not null default 0;

comment on column public.bdm_tasks.execution_id is
  'Authoritative claim token for the active task-step execution attempt.';

comment on column public.bdm_tasks.lease_owner is
  'Diagnostic worker/request identity. It is not an ownership credential.';

comment on column public.bdm_tasks.lease_expires_at is
  'Expiry for an active execution lease. Used for recovery decisions only.';

comment on column public.bdm_tasks.lease_generation is
  'Monotonically increasing fencing generation for claim attempts.';

-- Only one active execution token may exist in bdm_tasks at a time.
create unique index if not exists bdm_tasks_active_execution_uidx
  on public.bdm_tasks (execution_id)
  where execution_id is not null;

-- Supports recovery inspection of expired active leases without scanning all rows.
create index if not exists bdm_tasks_lease_expiry_idx
  on public.bdm_tasks (lease_expires_at)
  where execution_id is not null;

-- ---------------------------------------------------------------------------
-- Atomic claim function
-- ---------------------------------------------------------------------------
drop function if exists public.claim_task_step(
  uuid,
  integer,
  text,
  integer
);

create or replace function public.claim_task_step(
  p_task_id uuid,
  p_expected_step integer,
  p_lease_owner text default null,
  p_lease_seconds integer default 120
)
returns table (
  task_id uuid,
  current_step integer,
  execution_id uuid,
  lease_owner text,
  lease_expires_at timestamptz,
  lease_generation bigint
)
language plpgsql
security invoker
set search_path = public, pg_temp
as $function$
declare
  v_lease_seconds integer := least(greatest(coalesce(p_lease_seconds, 120), 10), 300);
begin
  if auth.uid() is null then
    raise exception 'unauthenticated';
  end if;

  if v_lease_seconds is null or v_lease_seconds < 10 or v_lease_seconds > 300 then
    raise exception 'invalid lease duration';
  end if;

  return query
  update public.bdm_tasks as t
  set
    execution_id = gen_random_uuid(),
    lease_owner = coalesce(nullif(btrim(p_lease_owner), ''), 'user:' || auth.uid()::text),
    lease_expires_at = now() + (v_lease_seconds * interval '1 second'),
    lease_generation = t.lease_generation + 1,
    status = case
      when t.status in ('queued', 'planning') then 'running'
      else t.status
    end,
    updated_at = now()
  where t.id = p_task_id
    and t.user_id = auth.uid()
    and t.current_step = p_expected_step
    and t.status in ('queued', 'planning', 'running')
    and (
      t.execution_id is null
      or t.lease_expires_at is null
      or t.lease_expires_at < now()
    )
  returning
    t.id,
    t.current_step,
    t.execution_id,
    t.lease_owner,
    t.lease_expires_at,
    t.lease_generation;
end;
$function$;

comment on function public.claim_task_step(uuid, integer, text, integer) is
  'Atomically claims a task step under a lease. Security invoker with authenticated RLS ownership checks.';

revoke execute on function public.claim_task_step(uuid, integer, text, integer) from public;
grant execute on function public.claim_task_step(uuid, integer, text, integer) to authenticated;

/*
  Rollback:
  revoke execute on function public.claim_task_step(uuid, integer, text, integer) from authenticated;
  drop function if exists public.claim_task_step(uuid, integer, text, integer);
  drop index if exists public.bdm_tasks_lease_expiry_idx;
  drop index if exists public.bdm_tasks_active_execution_uidx;
  alter table public.bdm_tasks drop column if exists lease_generation;
  alter table public.bdm_tasks drop column if exists lease_expires_at;
  alter table public.bdm_tasks drop column if exists lease_owner;
  alter table public.bdm_tasks drop column if exists execution_id;
*/
