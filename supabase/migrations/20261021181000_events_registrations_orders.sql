-- Events with paid registrations, plus merch orders fulfilled manually.
-- Every table has RLS on and no policies, so the Data API can't read or write them directly.
-- The only public entry point is list_upcoming_events(). Edge functions use the service role.

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Events -------------------------------------------------------------------

create table public.events (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  title text not null,
  summary text,
  description text,
  location text,
  starts_at timestamptz not null,
  ends_at timestamptz,
  price_pence integer not null default 0 check (price_pence >= 0),
  currency text not null default 'gbp' check (currency ~ '^[a-z]{3}$'),
  -- null means unlimited places
  capacity integer check (capacity is null or capacity > 0),
  signups_close_at timestamptz,
  is_published boolean not null default false,
  is_signup_open boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or ends_at >= starts_at)
);

create trigger events_set_updated_at
before update on public.events
for each row execute function public.set_updated_at();

create table public.registrations (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete restrict,
  status text not null default 'pending'
    check (status in ('pending', 'paid', 'cancelled', 'expired', 'refunded')),
  -- the person booking and paying
  full_name text not null check (char_length(full_name) between 1 and 200),
  email text not null check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  phone text,
  -- the person taking part, which may be a child booked by a parent
  attendee_name text not null check (char_length(attendee_name) between 1 and 200),
  attendee_date_of_birth date,
  emergency_contact_name text,
  emergency_contact_phone text,
  notes text check (notes is null or char_length(notes) <= 2000),
  newsletter_opt_in boolean not null default false,
  terms_accepted_at timestamptz not null,
  amount_pence integer not null check (amount_pence >= 0),
  currency text not null,
  stripe_checkout_session_id text unique,
  stripe_payment_intent_id text,
  -- a pending booking holds a place until this time
  expires_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index registrations_event_status_idx on public.registrations (event_id, status);
create index registrations_payment_intent_idx on public.registrations (stripe_payment_intent_id);

create trigger registrations_set_updated_at
before update on public.registrations
for each row execute function public.set_updated_at();

-- Merch --------------------------------------------------------------------

create table public.products (
  id text primary key check (id ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text not null,
  description text,
  price_pence integer not null check (price_pence >= 0),
  currency text not null default 'gbp' check (currency ~ '^[a-z]{3}$'),
  colours text[] not null default '{}',
  sizes text[] not null default '{}',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger products_set_updated_at
before update on public.products
for each row execute function public.set_updated_at();

insert into public.products (id, name, price_pence, colours, sizes)
values ('bulldogs-tee', 'Bulldogs Tee', 2500, '{orange,blue}', '{S,M,L,XL}');

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'pending'
    check (status in ('pending', 'paid', 'fulfilled', 'cancelled', 'expired', 'refunded')),
  -- customer and shipping details are filled in from Stripe once paid
  customer_name text,
  customer_email text,
  customer_phone text,
  shipping_address jsonb,
  amount_subtotal_pence integer not null check (amount_subtotal_pence >= 0),
  amount_shipping_pence integer not null default 0 check (amount_shipping_pence >= 0),
  amount_total_pence integer check (amount_total_pence >= 0),
  currency text not null,
  stripe_checkout_session_id text unique,
  stripe_payment_intent_id text,
  paid_at timestamptz,
  fulfilled_at timestamptz,
  -- e.g. the Tapstitch order number
  fulfilment_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index orders_status_idx on public.orders (status);
create index orders_payment_intent_idx on public.orders (stripe_payment_intent_id);

create trigger orders_set_updated_at
before update on public.orders
for each row execute function public.set_updated_at();

create table public.order_items (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.orders (id) on delete cascade,
  product_id text not null references public.products (id) on delete restrict,
  product_name text not null,
  colour text,
  size text,
  quantity integer not null check (quantity between 1 and 20),
  unit_price_pence integer not null check (unit_price_pence >= 0)
);

create index order_items_order_idx on public.order_items (order_id);

-- Access -------------------------------------------------------------------

alter table public.events enable row level security;
alter table public.registrations enable row level security;
alter table public.products enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;

revoke all on table public.events, public.registrations, public.products, public.orders, public.order_items
  from anon, authenticated;
grant select, insert, update, delete
  on table public.events, public.registrations, public.products, public.orders, public.order_items
  to service_role;
grant usage, select on sequence public.order_items_id_seq to service_role;

revoke execute on function public.set_updated_at() from public, anon, authenticated;

-- Functions ----------------------------------------------------------------

-- Public listing for the events page. Counts paid bookings plus unexpired pending holds.
create or replace function public.list_upcoming_events()
returns table (
  id uuid,
  slug text,
  title text,
  summary text,
  description text,
  location text,
  starts_at timestamptz,
  ends_at timestamptz,
  price_pence integer,
  currency text,
  capacity integer,
  spaces_left integer,
  is_bookable boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    e.id,
    e.slug,
    e.title,
    e.summary,
    e.description,
    e.location,
    e.starts_at,
    e.ends_at,
    e.price_pence,
    e.currency,
    e.capacity,
    case when e.capacity is null then null else greatest(e.capacity - t.taken, 0) end,
    e.is_signup_open
      and e.starts_at > now()
      and (e.signups_close_at is null or e.signups_close_at > now())
      and (e.capacity is null or t.taken < e.capacity)
  from public.events e
  cross join lateral (
    select count(*)::integer as taken
    from public.registrations r
    where r.event_id = e.id
      and (r.status = 'paid' or (r.status = 'pending' and r.expires_at > now()))
  ) t
  where e.is_published
    and coalesce(e.ends_at, e.starts_at) >= now()
  order by e.starts_at;
$$;

revoke execute on function public.list_upcoming_events() from public;
grant execute on function public.list_upcoming_events() to anon, authenticated, service_role;

-- Locks the event row so two people can't take the last place at the same time.
create or replace function public.reserve_event_place(
  p_event_id uuid,
  p_full_name text,
  p_email text,
  p_phone text,
  p_attendee_name text,
  p_attendee_date_of_birth date,
  p_emergency_contact_name text,
  p_emergency_contact_phone text,
  p_notes text,
  p_newsletter_opt_in boolean,
  p_hold_minutes integer default 40
)
returns table (
  registration_id uuid,
  event_title text,
  event_starts_at timestamptz,
  amount_pence integer,
  currency text
)
language plpgsql
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_event public.events%rowtype;
  v_taken integer;
  v_registration_id uuid;
begin
  select * into v_event from public.events where id = p_event_id for update;

  if not found or not v_event.is_published then
    raise exception 'event_not_found';
  end if;

  if not v_event.is_signup_open
    or v_event.starts_at <= now()
    or (v_event.signups_close_at is not null and v_event.signups_close_at <= now())
  then
    raise exception 'signups_closed';
  end if;

  if v_event.capacity is not null then
    select count(*) into v_taken
    from public.registrations r
    where r.event_id = p_event_id
      and (r.status = 'paid' or (r.status = 'pending' and r.expires_at > now()));

    if v_taken >= v_event.capacity then
      raise exception 'event_full';
    end if;
  end if;

  insert into public.registrations (
    event_id,
    full_name,
    email,
    phone,
    attendee_name,
    attendee_date_of_birth,
    emergency_contact_name,
    emergency_contact_phone,
    notes,
    newsletter_opt_in,
    terms_accepted_at,
    amount_pence,
    currency,
    expires_at
  )
  values (
    p_event_id,
    p_full_name,
    lower(p_email),
    p_phone,
    p_attendee_name,
    p_attendee_date_of_birth,
    p_emergency_contact_name,
    p_emergency_contact_phone,
    p_notes,
    coalesce(p_newsletter_opt_in, false),
    now(),
    v_event.price_pence,
    v_event.currency,
    now() + make_interval(mins => p_hold_minutes)
  )
  returning id into v_registration_id;

  return query
  select v_registration_id, v_event.title, v_event.starts_at, v_event.price_pence, v_event.currency;
end;
$$;

revoke execute on function public.reserve_event_place(
  uuid, text, text, text, text, date, text, text, text, boolean, integer
) from public, anon, authenticated;
grant execute on function public.reserve_event_place(
  uuid, text, text, text, text, date, text, text, text, boolean, integer
) to service_role;
