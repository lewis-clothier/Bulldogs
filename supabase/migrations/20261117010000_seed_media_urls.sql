-- Point editable media fields at seeded Supabase Storage objects.
-- Logo, typemarks, and homepage hero remain in git assets/.

with base as (
  select 'https://cprrjgpxuhgflahskqpf.supabase.co/storage/v1/object/public/media/' as u
)
update public.site_media s
set
  url = b.u || case s.key
    when 'events_banner' then 'site/events_banner.jpg'
    when 'shop_banner' then 'site/shop_banner.jpg'
    when 'team_banner' then 'site/team_banner.jpg'
    when 'home_spot' then 'site/home_spot.png'
    when 'photo_band' then 'site/photo_band.jpg'
    when 'home_event_fallback' then 'site/home_event_fallback.jpg'
  end,
  updated_at = now()
from base b;

update public.products
set
  images = jsonb_build_object(
    'orange', jsonb_build_object(
      'front', 'https://cprrjgpxuhgflahskqpf.supabase.co/storage/v1/object/public/media/products/product_1_orange_front_cutout.png',
      'back', 'https://cprrjgpxuhgflahskqpf.supabase.co/storage/v1/object/public/media/products/product_1_orange_back_cutout.png'
    ),
    'blue', jsonb_build_object(
      'front', 'https://cprrjgpxuhgflahskqpf.supabase.co/storage/v1/object/public/media/products/product_1_blue_front_cutout.png',
      'back', 'https://cprrjgpxuhgflahskqpf.supabase.co/storage/v1/object/public/media/products/product_1_blue_back_cutout.png'
    )
  ),
  updated_at = now()
where id = 'bulldogs-tee';

update public.events
set cover_image = replace(
  cover_image,
  'assets/photos/web/',
  'https://cprrjgpxuhgflahskqpf.supabase.co/storage/v1/object/public/media/events/'
)
where cover_image like 'assets/photos/web/%';

delete from public.athletes;

insert into public.athletes (name, kit_number, role, image_url, sort_order, is_published, show_on_home) values
  ('Henry Mantel', null, 'Head Coach', 'https://cprrjgpxuhgflahskqpf.supabase.co/storage/v1/object/public/media/athletes/Henry%20Mantel.png', 10, true, false),
  ('Lewis Clothier', 7, 'Coach & Athlete', 'https://cprrjgpxuhgflahskqpf.supabase.co/storage/v1/object/public/media/athletes/Lewis%20Clothier.png', 20, true, false),
  ('Chanin Janse van Rensburg', 5, 'Coach & Athlete', 'https://cprrjgpxuhgflahskqpf.supabase.co/storage/v1/object/public/media/athletes/Chanin%20Janse%20Van%20Rensburg.png', 30, true, false),
  ('Lewis Bagguley', 1, 'Athlete', 'https://cprrjgpxuhgflahskqpf.supabase.co/storage/v1/object/public/media/athletes/Lewis%20Bagguley.png', 40, true, true),
  ('Joe Oldham', 4, 'Athlete', 'https://cprrjgpxuhgflahskqpf.supabase.co/storage/v1/object/public/media/athletes/Joe%20Oldham.png', 50, true, true),
  ('Peter Goldberg', 6, 'Athlete', 'https://cprrjgpxuhgflahskqpf.supabase.co/storage/v1/object/public/media/athletes/Peter%20Goldberg.png', 60, true, true),
  ('Leo Davidson', 8, 'Athlete', 'https://cprrjgpxuhgflahskqpf.supabase.co/storage/v1/object/public/media/athletes/Leo%20Davidson.png', 70, true, true),
  ('Isaac Benninson', 9, 'Athlete', 'https://cprrjgpxuhgflahskqpf.supabase.co/storage/v1/object/public/media/athletes/Isaac%20Benninson.png', 80, true, true),
  ('Will Calder', 10, 'Athlete', 'https://cprrjgpxuhgflahskqpf.supabase.co/storage/v1/object/public/media/athletes/Will%20Calder.png', 90, true, true),
  ('Ebbe Larsen', 11, 'Athlete', 'https://cprrjgpxuhgflahskqpf.supabase.co/storage/v1/object/public/media/athletes/Ebbe%20Larsen.png', 100, true, true),
  ('Daan Lammertink', 14, 'Athlete', 'https://cprrjgpxuhgflahskqpf.supabase.co/storage/v1/object/public/media/athletes/Daan%20Lammertink.png', 110, true, true),
  ('Matthew Capes', null, 'Athlete', 'https://cprrjgpxuhgflahskqpf.supabase.co/storage/v1/object/public/media/athletes/Matthew%20Capes.png', 120, true, false);

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
  order by a.sort_order, a.name;
$$;
