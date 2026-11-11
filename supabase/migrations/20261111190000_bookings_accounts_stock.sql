-- Family bookings, safeguarding, accounts, merch stock, newsletter.

-- Events: listing extras -------------------------------------------------

alter table public.events
  add column if not exists age_range text,
  add column if not exists what_to_bring text;

-- Bookings (one payment, N attendees) ------------------------------------

create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete restrict,
  user_id uuid references auth.users (id) on delete set null,
  status text not null default 'pending'
    check (status in ('pending', 'paid', 'cancelled', 'expired', 'refunded')),
  full_name text not null check (char_length(full_name) between 1 and 200),
  email text not null check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  phone text,
  newsletter_opt_in boolean not null default false,
  terms_accepted_at timestamptz not null,
  guardian_confirmed boolean not null default false,
  photo_consent boolean not null default false,
  place_count integer not null check (place_count > 0 and place_count <= 8),
  amount_pence integer not null check (amount_pence >= 0),
  currency text not null,
  stripe_checkout_session_id text unique,
  stripe_checkout_url text,
  stripe_payment_intent_id text,
  cancel_token text unique not null default encode(gen_random_bytes(24), 'hex'),
  expires_at timestamptz,
  paid_at timestamptz,
  abandoned_email_sent_at timestamptz,
  day_before_email_sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists bookings_event_status_idx on public.bookings (event_id, status);
create index if not exists bookings_email_idx on public.bookings (email);
create index if not exists bookings_user_idx on public.bookings (user_id);
create index if not exists bookings_payment_intent_idx on public.bookings (stripe_payment_intent_id);

drop trigger if exists bookings_set_updated_at on public.bookings;
create trigger bookings_set_updated_at
before update on public.bookings
for each row execute function public.set_updated_at();

-- Registrations: attendees under a booking -------------------------------

alter table public.registrations
  add column if not exists booking_id uuid references public.bookings (id) on delete cascade,
  add column if not exists user_id uuid references auth.users (id) on delete set null,
  add column if not exists medical_notes text,
  add column if not exists photo_consent boolean not null default false,
  add column if not exists guardian_confirmed boolean not null default false,
  add column if not exists checkin_token text unique,
  add column if not exists checked_in_at timestamptz;

update public.registrations
set checkin_token = encode(gen_random_bytes(24), 'hex')
where checkin_token is null;

alter table public.registrations
  alter column checkin_token set default encode(gen_random_bytes(24), 'hex');

alter table public.registrations
  drop constraint if exists registrations_stripe_checkout_session_id_key;

create index if not exists registrations_booking_idx on public.registrations (booking_id);

alter table public.registrations
  drop constraint if exists registrations_medical_notes_len;
alter table public.registrations
  add constraint registrations_medical_notes_len
  check (medical_notes is null or char_length(medical_notes) <= 2000);

-- Profiles + carts + newsletter ------------------------------------------

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  phone text,
  newsletter_opt_in boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, nullif(trim(coalesce(new.raw_user_meta_data->>'full_name', '')), ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

create table if not exists public.carts (
  user_id uuid primary key references auth.users (id) on delete cascade,
  items jsonb not null default '[]'::jsonb,
  abandoned_email_sent_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.newsletter_subscribers (
  email text primary key check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  user_id uuid references auth.users (id) on delete set null,
  source text not null default 'checkout',
  consented_at timestamptz not null default now(),
  unsubscribed_at timestamptz
);

-- Merch stock ------------------------------------------------------------

create table if not exists public.product_variants (
  product_id text not null references public.products (id) on delete cascade,
  colour text not null,
  size text not null,
  on_hand integer not null default 0 check (on_hand >= 0),
  reserved integer not null default 0 check (reserved >= 0),
  sold integer not null default 0 check (sold >= 0),
  updated_at timestamptz not null default now(),
  primary key (product_id, colour, size),
  check (reserved + sold <= on_hand)
);

drop trigger if exists product_variants_set_updated_at on public.product_variants;
create trigger product_variants_set_updated_at
before update on public.product_variants
for each row execute function public.set_updated_at();

alter table public.orders
  add column if not exists user_id uuid references auth.users (id) on delete set null,
  add column if not exists abandoned_email_sent_at timestamptz,
  add column if not exists stripe_checkout_url text,
  add column if not exists newsletter_opt_in boolean not null default false;

-- Access -----------------------------------------------------------------

alter table public.bookings enable row level security;
alter table public.profiles enable row level security;
alter table public.carts enable row level security;
alter table public.newsletter_subscribers enable row level security;
alter table public.product_variants enable row level security;

revoke all on table
  public.bookings, public.profiles, public.carts,
  public.newsletter_subscribers, public.product_variants
  from anon, authenticated;

grant select, insert, update, delete on table
  public.bookings, public.profiles, public.carts,
  public.newsletter_subscribers, public.product_variants,
  public.events, public.registrations, public.products,
  public.orders, public.order_items
  to service_role;

-- Public listing ---------------------------------------------------------

drop function if exists public.list_upcoming_events();

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
  is_bookable boolean,
  age_range text,
  what_to_bring text
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
      and (e.capacity is null or t.taken < e.capacity),
    e.age_range,
    e.what_to_bring
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

create or replace function public.list_shop_catalog()
returns table (
  id text,
  name text,
  description text,
  price_pence integer,
  currency text,
  variants jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    p.id,
    p.name,
    p.description,
    p.price_pence,
    p.currency,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'colour', v.colour,
        'size', v.size,
        'available', greatest(v.on_hand - v.reserved - v.sold, 0)
      ) order by v.colour, v.size)
      from public.product_variants v
      where v.product_id = p.id
    ), '[]'::jsonb)
  from public.products p
  where p.is_active
  order by p.name;
$$;

revoke execute on function public.list_shop_catalog() from public;
grant execute on function public.list_shop_catalog() to anon, authenticated, service_role;

-- Reserve event places ---------------------------------------------------

drop function if exists public.reserve_event_place(
  uuid, text, text, text, text, date, text, text, text, boolean, integer
);

create or replace function public.reserve_event_place(
  p_event_id uuid,
  p_full_name text,
  p_email text,
  p_phone text,
  p_attendees jsonb,
  p_newsletter_opt_in boolean,
  p_photo_consent boolean,
  p_guardian_confirmed boolean,
  p_user_id uuid,
  p_hold_minutes integer default 40
)
returns table (
  booking_id uuid,
  cancel_token text,
  event_title text,
  event_starts_at timestamptz,
  event_location text,
  event_what_to_bring text,
  amount_pence integer,
  currency text,
  place_count integer
)
language plpgsql
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_event public.events%rowtype;
  v_taken integer;
  v_places integer;
  v_booking_id uuid;
  v_cancel text;
  v_attendee jsonb;
  v_name text;
  v_dob date;
  v_has_minor boolean := false;
begin
  if p_photo_consent is not true then
    raise exception 'photo_consent_required';
  end if;

  if jsonb_typeof(p_attendees) is distinct from 'array' then
    raise exception 'attendees_required';
  end if;

  v_places := jsonb_array_length(p_attendees);
  if v_places < 1 or v_places > 8 then
    raise exception 'attendees_required';
  end if;

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

    if v_taken + v_places > v_event.capacity then
      raise exception 'event_full';
    end if;
  end if;

  for v_attendee in select * from jsonb_array_elements(p_attendees)
  loop
    v_name := nullif(trim(v_attendee->>'name'), '');
    if v_name is null then
      raise exception 'attendee_name_required';
    end if;
    if coalesce(v_attendee->>'date_of_birth', '') = '' then
      raise exception 'attendee_dob_required';
    end if;
    v_dob := (v_attendee->>'date_of_birth')::date;
    if v_dob >= current_date then
      raise exception 'attendee_dob_invalid';
    end if;
    if v_dob > (current_date - interval '18 years') then
      v_has_minor := true;
    end if;
    if nullif(trim(v_attendee->>'emergency_contact_name'), '') is null
      or nullif(trim(v_attendee->>'emergency_contact_phone'), '') is null
    then
      raise exception 'emergency_contact_required';
    end if;

    if exists (
      select 1
      from public.registrations r
      where r.event_id = p_event_id
        and lower(r.email) = lower(p_email)
        and lower(r.attendee_name) = lower(v_name)
        and (r.status = 'paid' or (r.status = 'pending' and r.expires_at > now()))
    ) then
      raise exception 'already_booked';
    end if;
  end loop;

  if v_has_minor and p_guardian_confirmed is not true then
    raise exception 'guardian_required';
  end if;

  insert into public.bookings (
    event_id, user_id, full_name, email, phone, newsletter_opt_in,
    terms_accepted_at, guardian_confirmed, photo_consent, place_count,
    amount_pence, currency, expires_at
  )
  values (
    p_event_id,
    p_user_id,
    p_full_name,
    lower(p_email),
    p_phone,
    coalesce(p_newsletter_opt_in, false),
    now(),
    coalesce(p_guardian_confirmed, false),
    true,
    v_places,
    v_event.price_pence * v_places,
    v_event.currency,
    now() + make_interval(mins => p_hold_minutes)
  )
  returning id, cancel_token into v_booking_id, v_cancel;

  for v_attendee in select * from jsonb_array_elements(p_attendees)
  loop
    insert into public.registrations (
      booking_id, event_id, user_id, status, full_name, email, phone,
      attendee_name, attendee_date_of_birth, emergency_contact_name,
      emergency_contact_phone, notes, medical_notes, newsletter_opt_in,
      photo_consent, guardian_confirmed, terms_accepted_at, amount_pence,
      currency, expires_at
    )
    values (
      v_booking_id,
      p_event_id,
      p_user_id,
      'pending',
      p_full_name,
      lower(p_email),
      p_phone,
      trim(v_attendee->>'name'),
      (v_attendee->>'date_of_birth')::date,
      nullif(trim(v_attendee->>'emergency_contact_name'), ''),
      nullif(trim(v_attendee->>'emergency_contact_phone'), ''),
      nullif(trim(v_attendee->>'notes'), ''),
      nullif(trim(v_attendee->>'medical_notes'), ''),
      coalesce(p_newsletter_opt_in, false),
      true,
      coalesce(p_guardian_confirmed, false),
      now(),
      v_event.price_pence,
      v_event.currency,
      now() + make_interval(mins => p_hold_minutes)
    );
  end loop;

  return query
  select v_booking_id, v_cancel, v_event.title, v_event.starts_at, v_event.location,
    v_event.what_to_bring, v_event.price_pence * v_places, v_event.currency, v_places;
end;
$$;

revoke execute on function public.reserve_event_place(
  uuid, text, text, text, jsonb, boolean, boolean, boolean, uuid, integer
) from public, anon, authenticated;
grant execute on function public.reserve_event_place(
  uuid, text, text, text, jsonb, boolean, boolean, boolean, uuid, integer
) to service_role;

-- Shop stock in one transaction ------------------------------------------

create or replace function public.create_shop_order(
  p_user_id uuid,
  p_email text,
  p_newsletter_opt_in boolean,
  p_items jsonb
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_line jsonb;
  v_product public.products%rowtype;
  v_qty integer;
  v_colour text;
  v_size text;
  v_available integer;
  v_subtotal integer := 0;
  v_currency text;
  v_order_id uuid;
begin
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'bag_empty';
  end if;
  if jsonb_array_length(p_items) > 20 then
    raise exception 'too_many_items';
  end if;

  for v_line in select * from jsonb_array_elements(p_items)
  loop
    select * into v_product from public.products
    where id = v_line->>'product_id' and is_active
    for update;
    if not found then
      raise exception 'item_unavailable';
    end if;
    if v_currency is null then
      v_currency := v_product.currency;
    elsif v_currency is distinct from v_product.currency then
      raise exception 'mixed_currency';
    end if;

    v_qty := (v_line->>'quantity')::integer;
    v_colour := lower(nullif(trim(v_line->>'colour'), ''));
    v_size := upper(nullif(trim(v_line->>'size'), ''));
    if v_qty is null or v_qty < 1 or v_qty > 10 then
      raise exception 'bad_quantity';
    end if;

    perform 1 from public.product_variants
    where product_id = v_product.id and colour = v_colour and size = v_size
    for update;
    if not found then
      raise exception 'item_unavailable';
    end if;

    select on_hand - reserved - sold into v_available
    from public.product_variants
    where product_id = v_product.id and colour = v_colour and size = v_size;

    if v_available < v_qty then
      raise exception 'out_of_stock';
    end if;

    update public.product_variants
    set reserved = reserved + v_qty
    where product_id = v_product.id and colour = v_colour and size = v_size;

    v_subtotal := v_subtotal + v_product.price_pence * v_qty;
  end loop;

  insert into public.orders (
    user_id, customer_email, newsletter_opt_in, amount_subtotal_pence, currency
  )
  values (p_user_id, lower(nullif(p_email, '')), coalesce(p_newsletter_opt_in, false), v_subtotal, v_currency)
  returning id into v_order_id;

  insert into public.order_items (
    order_id, product_id, product_name, colour, size, quantity, unit_price_pence
  )
  select
    v_order_id,
    p.id,
    p.name,
    lower(nullif(trim(line->>'colour'), '')),
    upper(nullif(trim(line->>'size'), '')),
    (line->>'quantity')::integer,
    p.price_pence
  from jsonb_array_elements(p_items) as line
  join public.products p on p.id = line->>'product_id';

  return v_order_id;
end;
$$;

create or replace function public.release_shop_order_stock(p_order_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  update public.product_variants v
  set reserved = reserved - i.quantity
  from public.order_items i
  where i.order_id = p_order_id
    and v.product_id = i.product_id
    and v.colour is not distinct from i.colour
    and v.size is not distinct from i.size
    and v.reserved >= i.quantity;
end;
$$;

create or replace function public.fulfil_shop_order_stock(p_order_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  update public.product_variants v
  set reserved = reserved - i.quantity,
      sold = sold + i.quantity
  from public.order_items i
  where i.order_id = p_order_id
    and v.product_id = i.product_id
    and v.colour is not distinct from i.colour
    and v.size is not distinct from i.size
    and v.reserved >= i.quantity;
end;
$$;

revoke execute on function public.create_shop_order(uuid, text, boolean, jsonb) from public, anon, authenticated;
revoke execute on function public.release_shop_order_stock(uuid) from public, anon, authenticated;
revoke execute on function public.fulfil_shop_order_stock(uuid) from public, anon, authenticated;
grant execute on function public.create_shop_order(uuid, text, boolean, jsonb) to service_role;
grant execute on function public.release_shop_order_stock(uuid) to service_role;
grant execute on function public.fulfil_shop_order_stock(uuid) to service_role;

-- Seed catalog + dummy event --------------------------------------------

insert into public.products (id, name, price_pence, colours, sizes, description)
values (
  'bulldogs-tee',
  'Bulldogs Tee',
  2500,
  '{orange,blue}',
  '{S,M,L,XL}',
  'Navy tee with chest print and full back graphic.'
)
on conflict (id) do update
set name = excluded.name,
    price_pence = excluded.price_pence,
    colours = excluded.colours,
    sizes = excluded.sizes,
    is_active = true;

insert into public.product_variants (product_id, colour, size, on_hand)
select 'bulldogs-tee', c.colour, s.size, 10
from (values ('orange'), ('blue')) as c(colour)
cross join (values ('S'), ('M'), ('L'), ('XL')) as s(size)
on conflict (product_id, colour, size) do nothing;

insert into public.events (
  slug, title, summary, description, location, starts_at, ends_at,
  price_pence, currency, capacity, is_published, is_signup_open, age_range, what_to_bring
)
values (
  'dummy-taster',
  'Dummy taster session',
  'A test date so we can check paid signup end to end.',
  'Bring water and trainers. This is a placeholder event.',
  'Bulldogs gym, London',
  timestamptz '2026-11-28 10:00:00+00',
  timestamptz '2026-11-28 12:00:00+00',
  1500,
  'gbp',
  8,
  true,
  true,
  '6–16',
  'Water, trainers, comfortable kit. Hair tied back.'
)
on conflict (slug) do update
set title = excluded.title,
    summary = excluded.summary,
    location = excluded.location,
    starts_at = excluded.starts_at,
    ends_at = excluded.ends_at,
    price_pence = excluded.price_pence,
    capacity = excluded.capacity,
    is_published = true,
    is_signup_open = true,
    age_range = excluded.age_range,
    what_to_bring = excluded.what_to_bring;
