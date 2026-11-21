-- Delete records once the club no longer needs them:
--   * bookings (and their attendees) 7 years after the event, orders (and their items) 7 years after
--     the order. HMRC needs 6 years from the end of the financial year, so 7 years from the date
--     covers any year-end.
--   * waiting-list sign-ups 30 days after the event.
-- Runs on the 1st of each month.

create or replace function public.purge_old_records()
returns integer
language sql
security definer
set search_path to ''
as $$
  with old_bookings as (
    delete from public.bookings b
    using public.events e
    where e.id = b.event_id
      and coalesce(e.ends_at, e.starts_at) < now() - interval '7 years'
    returning 1
  ),
  old_orders as (
    delete from public.orders o
    where o.created_at < now() - interval '7 years'
    returning 1
  ),
  old_waitlist as (
    delete from public.event_waitlist w
    using public.events e
    where e.id = w.event_id
      and coalesce(e.ends_at, e.starts_at) < now() - interval '30 days'
    returning 1
  )
  select ((select count(*) from old_bookings) + (select count(*) from old_orders) + (select count(*) from old_waitlist))::integer;
$$;

revoke all on function public.purge_old_records() from public, anon, authenticated;

select cron.unschedule('purge-old-records')
where exists (select 1 from cron.job where jobname = 'purge-old-records');

select cron.schedule('purge-old-records', '30 3 1 * *', 'select public.purge_old_records()');
