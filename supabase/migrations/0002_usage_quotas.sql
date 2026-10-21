-- ---------------------------------------------------------------------------
-- Durable per-user and shared usage quotas.
--
-- Why a table + SECURITY DEFINER functions instead of counters in process:
--   * Render restarts instances and may run more than one, so an in-memory
--     counter is not a production control.
--   * The upsert is a single atomic statement, so two concurrent requests
--     cannot both pass the last remaining slot.
--
-- The counter table has RLS enabled with no policies: clients can neither
-- read nor tamper with it. All access goes through the functions below,
-- which either bind the subject to auth.uid() or accept a bounded,
-- server-computed subject for unauthenticated email throttling.
--
-- Window boundaries are computed by the server (UTC) and passed in, so the
-- reset time returned to a caller is exact and testable.
-- ---------------------------------------------------------------------------

create table if not exists public.bdm_usage_counters (
  scope text not null check (scope in ('user', 'shared')),
  subject text not null,
  feature text not null,
  window_start timestamptz not null,
  count integer not null default 0 check (count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (scope, subject, feature, window_start)
);

create index if not exists bdm_usage_counters_window_idx
  on public.bdm_usage_counters (window_start);

alter table public.bdm_usage_counters enable row level security;

-- Deliberately no policies. The functions below are the only entry point.

-- ---------------------------------------------------------------------------
-- Authenticated per-user quota.
-- ---------------------------------------------------------------------------
create or replace function public.bdm_consume_user_quota(
  p_feature text,
  p_window_start timestamptz,
  p_reset_at timestamptz,
  p_limit integer
)
returns table (allowed boolean, used integer, remaining integer, reset_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_count integer;
  v_used integer;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  if p_limit is null or p_limit < 0 then
    raise exception 'invalid limit' using errcode = '22023';
  end if;
  if p_feature is null or length(p_feature) > 64 or p_feature !~ '^[a-z0-9._-]+$' then
    raise exception 'invalid feature' using errcode = '22023';
  end if;

  if p_limit = 0 then
    return query select false, 0, 0, p_reset_at;
    return;
  end if;

  insert into public.bdm_usage_counters as c
    (scope, subject, feature, window_start, count)
  values
    ('user', v_uid::text, p_feature, p_window_start, 1)
  on conflict (scope, subject, feature, window_start)
  do update set count = c.count + 1, updated_at = now()
  where c.count < p_limit
  returning c.count into v_count;

  if v_count is null then
    select c.count into v_used
      from public.bdm_usage_counters c
     where c.scope = 'user'
       and c.subject = v_uid::text
       and c.feature = p_feature
       and c.window_start = p_window_start;

    return query select false, coalesce(v_used, p_limit), 0, p_reset_at;
    return;
  end if;

  return query select true, v_count, greatest(0, p_limit - v_count), p_reset_at;
end;
$$;

revoke all on function public.bdm_consume_user_quota(text, timestamptz, timestamptz, integer) from public;
grant execute on function public.bdm_consume_user_quota(text, timestamptz, timestamptz, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- Shared quota for unauthenticated email throttling.
--
-- The subject is a SHA-256 hash computed by the server (never a raw email
-- address), and is bounded before it can reach the table. A direct caller
-- cannot use this to send anything; it only increments a counter.
-- ---------------------------------------------------------------------------
create or replace function public.bdm_consume_shared_quota(
  p_subject text,
  p_feature text,
  p_window_start timestamptz,
  p_reset_at timestamptz,
  p_limit integer
)
returns table (allowed boolean, used integer, remaining integer, reset_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
  v_used integer;
begin
  if p_subject is null or length(p_subject) < 16 or length(p_subject) > 128 then
    raise exception 'invalid subject' using errcode = '22023';
  end if;
  if p_limit is null or p_limit < 0 then
    raise exception 'invalid limit' using errcode = '22023';
  end if;
  if p_feature is null or length(p_feature) > 64 or p_feature !~ '^[a-z0-9._-]+$' then
    raise exception 'invalid feature' using errcode = '22023';
  end if;

  if p_limit = 0 then
    return query select false, 0, 0, p_reset_at;
    return;
  end if;

  insert into public.bdm_usage_counters as c
    (scope, subject, feature, window_start, count)
  values
    ('shared', p_subject, p_feature, p_window_start, 1)
  on conflict (scope, subject, feature, window_start)
  do update set count = c.count + 1, updated_at = now()
  where c.count < p_limit
  returning c.count into v_count;

  if v_count is null then
    select c.count into v_used
      from public.bdm_usage_counters c
     where c.scope = 'shared'
       and c.subject = p_subject
       and c.feature = p_feature
       and c.window_start = p_window_start;

    return query select false, coalesce(v_used, p_limit), 0, p_reset_at;
    return;
  end if;

  return query select true, v_count, greatest(0, p_limit - v_count), p_reset_at;
end;
$$;

revoke all on function public.bdm_consume_shared_quota(text, text, timestamptz, timestamptz, integer) from public;
grant execute on function public.bdm_consume_shared_quota(text, text, timestamptz, timestamptz, integer) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Retention: counters older than 30 days are no longer useful.
-- Called opportunistically by the server (best effort).
-- ---------------------------------------------------------------------------
create or replace function public.bdm_prune_usage_counters()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.bdm_usage_counters
   where window_start < now() - interval '30 days';
$$;

revoke all on function public.bdm_prune_usage_counters() from public;
grant execute on function public.bdm_prune_usage_counters() to authenticated;
