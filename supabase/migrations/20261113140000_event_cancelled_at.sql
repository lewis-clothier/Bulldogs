-- Mark cancelled events so staff can filter them separately from drafts.
alter table public.events
  add column if not exists cancelled_at timestamptz;

comment on column public.events.cancelled_at is
  'Set when the club cancels the event. Cleared if the event is published again.';
