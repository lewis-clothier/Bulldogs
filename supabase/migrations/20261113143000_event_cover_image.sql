-- Staff-chosen cover image for the public events page.
alter table public.events
  add column if not exists cover_image text;

comment on column public.events.cover_image is
  'Relative path under the site root for the event card photo.';

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
  what_to_bring text,
  cover_image text
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
    e.what_to_bring,
    e.cover_image
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
