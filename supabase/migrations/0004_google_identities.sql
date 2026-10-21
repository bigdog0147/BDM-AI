/*
  Google identity links (account-linking guard).

  This table does not replace Supabase Auth. Users, identities, and sessions
  remain in auth.users / auth.identities. It records which Google `sub` has
  been deliberately linked to which existing user so a Google sign-in can
  never silently attach to a password account merely because the email
  matches.

  RLS is enabled with no policies. Only the server-side service-role client
  (lib/google-identity-store.ts) may read or write this table.
*/

create table if not exists public.bdm_google_identities (
  google_sub text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  email text not null,
  created_at timestamptz not null default now(),
  last_login_at timestamptz not null default now()
);

-- One Google identity per BDM account. A user must not be able to attach two
-- different Google accounts, and a Google account cannot point at two users.
create unique index if not exists bdm_google_identities_user_id_key
  on public.bdm_google_identities (user_id);

create index if not exists bdm_google_identities_email_idx
  on public.bdm_google_identities (lower(email));

alter table public.bdm_google_identities enable row level security;

comment on table public.bdm_google_identities is
  'Explicit Google OIDC links. Server-only; RLS enabled with no policies.';
