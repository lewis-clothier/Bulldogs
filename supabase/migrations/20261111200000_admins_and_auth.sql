-- Club admins (email-based, so access can be granted before they sign up).
-- Lewis / the club mailbox is the only starting admin.

create table if not exists public.admins (
  email text primary key check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  user_id uuid unique references auth.users (id) on delete set null,
  granted_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.admins enable row level security;
revoke all on table public.admins from anon, authenticated;
grant select, insert, update, delete on table public.admins to service_role;

insert into public.admins (email)
values ('bulldogs.limited@gmail.com')
on conflict (email) do nothing;

create or replace function public.link_admin_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.admins
  set user_id = new.id
  where email = lower(new.email)
    and user_id is null;
  return new;
end;
$$;

drop trigger if exists on_auth_user_link_admin on auth.users;
create trigger on_auth_user_link_admin
after insert on auth.users
for each row execute function public.link_admin_user();
