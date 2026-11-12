-- People who asked to be told if a full event gets a place back.
create table if not exists public.event_waitlist (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  email text not null check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  full_name text,
  created_at timestamptz not null default now(),
  unique (event_id, email)
);

alter table public.event_waitlist enable row level security;

revoke all on table public.event_waitlist from anon, authenticated;
grant select, insert, update, delete on table public.event_waitlist to service_role;
