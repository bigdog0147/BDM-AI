/*
  RLS Grants for BDM tables.

  Applies proper role-based access control to all BDM tables.
  This migration should be run after all tables are created (after 0004).

  Roles:
  - anon: unauthenticated users (very limited access, mostly none for user data)
  - authenticated: logged-in users (access to their own data via RLS policies)
  - service_role: server-side operations (full access, bypasses RLS)
*/

-- Enable RLS on all tables (idempotent)
alter table if exists public.bdm_profiles enable row level security;
alter table if exists public.bdm_conversations enable row level security;
alter table if exists public.bdm_messages enable row level security;
alter table if exists public.bdm_memories enable row level security;
alter table if exists public.bdm_email_events enable row level security;
alter table if exists public.bdm_usage_counters enable row level security;
alter table if exists public.bdm_google_identities enable row level security;

-- Grant SELECT to anon (very limited - only for public/shareable content if any)
-- Most BDM tables should NOT grant anon access since data is private
-- grant select on public.bdm_profiles to anon;  -- Intentionally omitted

-- Grant full CRUD to authenticated users
-- RLS policies will restrict to own data
grant select, insert, update, delete
on public.bdm_profiles
to authenticated;

grant select, insert, update, delete
on public.bdm_conversations
to authenticated;

grant select, insert, update, delete
on public.bdm_messages
to authenticated;

grant select, insert, update, delete
on public.bdm_memories
to authenticated;

grant select, insert, update, delete
on public.bdm_email_events
to authenticated;

grant select, insert, update, delete
on public.bdm_usage_counters
to authenticated;

grant select, insert, update, delete
on public.bdm_google_identities
to authenticated;

-- Grant full access to service_role (bypasses RLS)
grant select, insert, update, delete
on public.bdm_profiles
to service_role;

grant select, insert, update, delete
on public.bdm_conversations
to service_role;

grant select, insert, update, delete
on public.bdm_messages
to service_role;

grant select, insert, update, delete
on public.bdm_memories
to service_role;

grant select, insert, update, delete
on public.bdm_email_events
to service_role;

grant select, insert, update, delete
on public.bdm_usage_counters
to service_role;

grant select, insert, update, delete
on public.bdm_google_identities
to service_role;

-- Ensure RLS policies exist for authenticated users on each table
-- (These should already exist from 0001_bdm_foundation.sql, but we verify)

-- bdm_profiles: users can only access their own profile
-- (Policy: "Users can view own profile" from 0001)

-- bdm_conversations: users can only access their own conversations
-- (Policy: "Users can view own conversations" from 0001)

-- bdm_messages: users can only access messages in their conversations
-- (Policy: "Users can view messages in own conversations" from 0001)

-- bdm_memories: users can only access their own memories
-- (Policy: "Users can view own memories" from 0001)

-- bdm_email_events: no authenticated access (server-only via service_role)
-- No policies for authenticated - only service_role can write

-- bdm_usage_counters: users can view their own counters
-- (Policy: "Users can view own usage" from 0002)

-- bdm_google_identities: server-only access (no authenticated policies)
-- Only service_role can read/write

comment on table public.bdm_profiles is
  'User profiles. RLS: authenticated users access own row only.';

comment on table public.bdm_conversations is
  'Conversations. RLS: authenticated users access own conversations only.';

comment on table public.bdm_messages is
  'Messages. RLS: authenticated users access messages in own conversations only.';

comment on table public.bdm_memories is
  'Long-term memories. RLS: authenticated users access own memories only.';

comment on table public.bdm_email_events is
  'Email webhook events. RLS: no authenticated access. Server-only via service_role.';

comment on table public.bdm_usage_counters is
  'Usage quotas. RLS: authenticated users view own counters only.';

comment on table public.bdm_google_identities is
  'Google identity links. RLS: no authenticated access. Server-only via service_role.';