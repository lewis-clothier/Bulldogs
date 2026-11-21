-- Run the send-reminders edge function every 5 minutes from inside Supabase.
-- It emails each confirmed booking once, when the event is 24 hours away.
-- The shared secret lives in Vault as 'cron_secret' (created outside migrations so it never
-- lands in git) and must match the CRON_SECRET edge function secret.
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('send-event-reminders')
where exists (select 1 from cron.job where jobname = 'send-event-reminders');

select cron.schedule(
  'send-event-reminders',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := 'https://cprrjgpxuhgflahskqpf.supabase.co/functions/v1/send-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $$
);
