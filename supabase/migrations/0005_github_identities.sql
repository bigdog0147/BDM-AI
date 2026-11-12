/*
  GitHub identity links (account-linking guard).

  Same guard pattern as bdm_google_identities: only the server-side
  service-role client (lib/github-identity-store.ts) may read/write.
*/

create table if not exists public.bdm_github_identities (
  github_id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  email text not null,
  created_at timestamptz not null default now(),
  last_login_at timestamptz not null default now()
);

create unique index if not exists bdm_github_identities_user_id_key
  on public.bdm_github_identities (user_id);

create index if not exists bdm_github_identities_email_idx
  on public.bdm_github_identities (lower(email));

alter table public.bdm_github_identities enable row level security;

comment on table public.bdm_github_identities is
  'Explicit GitHub OAuth links. Server-only; RLS enabled with no policies.';
