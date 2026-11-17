-- Public media library for admin-editable site photos.
-- Fixed brand chrome (logo, typemarks, homepage hero) stays in git.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'media',
  'media',
  true,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']::text[]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.admins a
    where lower(a.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated, service_role;

drop policy if exists "Admins can read media objects" on storage.objects;
drop policy if exists "Admins can upload media objects" on storage.objects;
drop policy if exists "Admins can update media objects" on storage.objects;
drop policy if exists "Admins can delete media objects" on storage.objects;

create policy "Admins can read media objects"
on storage.objects for select to authenticated
using (bucket_id = 'media' and public.is_admin());

create policy "Admins can upload media objects"
on storage.objects for insert to authenticated
with check (bucket_id = 'media' and public.is_admin());

create policy "Admins can update media objects"
on storage.objects for update to authenticated
using (bucket_id = 'media' and public.is_admin())
with check (bucket_id = 'media' and public.is_admin());

create policy "Admins can delete media objects"
on storage.objects for delete to authenticated
using (bucket_id = 'media' and public.is_admin());

alter table public.products
  add column if not exists images jsonb not null default '{}'::jsonb;

comment on column public.products.images is
  'Map of colour -> { front, back } public media URLs.';

create table if not exists public.site_media (
  key text primary key,
  label text not null,
  url text,
  updated_at timestamptz not null default now()
);

comment on table public.site_media is
  'Named editable site image slots (banners, home spot, photo band, etc).';

alter table public.site_media enable row level security;

drop policy if exists "Public can read site media" on public.site_media;
create policy "Public can read site media"
on public.site_media for select
to anon, authenticated
using (true);

create table if not exists public.athletes (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kit_number integer,
  role text not null default 'Athlete',
  image_url text,
  sort_order integer not null default 100,
  is_published boolean not null default true,
  show_on_home boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.athletes is
  'Roster / coaching staff shown on team and home pages.';

alter table public.athletes enable row level security;

drop policy if exists "Public can read published athletes" on public.athletes;
create policy "Public can read published athletes"
on public.athletes for select
to anon, authenticated
using (is_published);

drop function if exists public.list_shop_catalog();

create or replace function public.list_shop_catalog()
returns table (
  id text,
  name text,
  description text,
  price_pence integer,
  currency text,
  images jsonb,
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
    coalesce(p.images, '{}'::jsonb),
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'colour', v.colour,
        'size', v.size,
        'available', greatest(v.on_hand - v.reserved, 0)
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

create or replace function public.list_site_media()
returns table (
  key text,
  label text,
  url text
)
language sql
stable
security definer
set search_path = ''
as $$
  select s.key, s.label, s.url
  from public.site_media s
  order by s.label;
$$;

revoke execute on function public.list_site_media() from public;
grant execute on function public.list_site_media() to anon, authenticated, service_role;

create or replace function public.list_athletes()
returns table (
  id uuid,
  name text,
  kit_number integer,
  role text,
  image_url text,
  sort_order integer,
  show_on_home boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select a.id, a.name, a.kit_number, a.role, a.image_url, a.sort_order, a.show_on_home
  from public.athletes a
  where a.is_published
  order by
    case when a.kit_number is null then 1 else 0 end,
    a.kit_number nulls last,
    a.sort_order,
    a.name;
$$;

revoke execute on function public.list_athletes() from public;
grant execute on function public.list_athletes() to anon, authenticated, service_role;

insert into public.site_media (key, label, url) values
  ('events_banner', 'Events page banner', null),
  ('shop_banner', 'Shop page banner', null),
  ('team_banner', 'Team page banner', null),
  ('home_spot', 'Home product spot', null),
  ('photo_band', 'Home photo band', null),
  ('home_event_fallback', 'Home event card fallback', null)
on conflict (key) do nothing;
