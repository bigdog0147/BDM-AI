-- BDM-AI database foundation: profiles, conversations, messages, memories.
--
-- STATUS: LOCAL REVIEWABLE FILE ONLY. This has NOT been executed against any
-- hosted or production database. Apply it manually to a development project
-- (e.g. via the Supabase SQL editor or `supabase db push` against a local/dev
-- project) after review.
--
-- Security model: every table is protected by Row Level Security with
-- deny-by-default policies keyed on auth.uid(). A user can only ever read or
-- write rows they own. The publishable (anon) key is safe in the browser
-- precisely because RLS - not the key - is the access boundary.

-- ---------------------------------------------------------------------------
-- profiles: one row per authenticated user, mirrored from auth.users.
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles are self-readable"
  on public.profiles for select
  using (auth.uid() = id);

create policy "profiles are self-insertable"
  on public.profiles for insert
  with check (auth.uid() = id);

create policy "profiles are self-updatable"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- ---------------------------------------------------------------------------
-- conversations: a titled thread owned by a user.
-- ---------------------------------------------------------------------------
create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null default 'New conversation',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists conversations_user_id_idx
  on public.conversations (user_id, updated_at desc);

alter table public.conversations enable row level security;

create policy "conversations are owner-readable"
  on public.conversations for select
  using (auth.uid() = user_id);

create policy "conversations are owner-insertable"
  on public.conversations for insert
  with check (auth.uid() = user_id);

create policy "conversations are owner-updatable"
  on public.conversations for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "conversations are owner-deletable"
  on public.conversations for delete
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- messages: individual turns within a conversation.
-- ---------------------------------------------------------------------------
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null
    references public.conversations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'system')),
  content text not null,
  created_at timestamptz not null default now()
);

create index if not exists messages_conversation_idx
  on public.messages (conversation_id, created_at);

alter table public.messages enable row level security;

create policy "messages are owner-readable"
  on public.messages for select
  using (auth.uid() = user_id);

create policy "messages are owner-insertable"
  on public.messages for insert
  with check (auth.uid() = user_id);

create policy "messages are owner-updatable"
  on public.messages for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "messages are owner-deletable"
  on public.messages for delete
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- memories: long-term, user-controlled facts with provenance.
-- ---------------------------------------------------------------------------
create table if not exists public.memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  content text not null,
  source text not null default 'user' check (source in ('user', 'assistant', 'imported')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists memories_user_id_idx
  on public.memories (user_id, updated_at desc);

alter table public.memories enable row level security;

create policy "memories are owner-readable"
  on public.memories for select
  using (auth.uid() = user_id);

create policy "memories are owner-insertable"
  on public.memories for insert
  with check (auth.uid() = user_id);

create policy "memories are owner-updatable"
  on public.memories for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "memories are owner-deletable"
  on public.memories for delete
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Note: RLS is enforced for the anon/publishable role automatically because
-- these policies apply to all roles. No anon insert is granted by default;
-- only authenticated owners matching auth.uid() may write.
