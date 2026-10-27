-- ---------------------------------------------------------------------------
-- Delivery events from the email provider (Resend), verified by signature in
-- the application before they reach this table.
--
-- Stored deliberately minimally: event identity, type, provider message id,
-- and timestamps. Recipients, subjects, and bodies are not retained.
--
-- RLS is enabled with no policies: only the service role (used server-side by
-- the webhook route) can read or write. Nothing is exposed to anon or
-- authenticated clients, so a forged client-side insert is impossible.
-- ---------------------------------------------------------------------------

create table if not exists public.bdm_email_events (
  id bigint generated always as identity primary key,
  provider text not null default 'resend' check (provider in ('resend')),
  event_id text not null unique,
  event_type text not null check (
    event_type in (
      'email.sent',
      'email.delivered',
      'email.delivery_delayed',
      'email.complained',
      'email.bounced',
      'email.opened',
      'email.clicked'
    )
  ),
  email_id text,
  occurred_at timestamptz,
  received_at timestamptz not null default now()
);

create index if not exists bdm_email_events_email_idx
  on public.bdm_email_events (email_id);

create index if not exists bdm_email_events_type_idx
  on public.bdm_email_events (event_type, received_at desc);

alter table public.bdm_email_events enable row level security;

comment on table public.bdm_email_events is
  'Verified Resend delivery events. Service-role access only; no client policies.';
