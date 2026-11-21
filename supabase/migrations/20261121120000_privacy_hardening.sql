-- Privacy hardening before launch:
--   1. Photo/video consent is optional and recorded per attendee (consent you must give to book isn't valid).
--   2. Record when the booker agreed to us storing medical/allergy notes.
--   3. Newsletter/event-alert sign-ups need confirming by email, and every email can unsubscribe in one click.
--   4. Medical notes and emergency contacts are deleted 30 days after the event, and unpaid
--      bookings lose attendee dates of birth after 30 days.
--   5. Trigger-only functions can't be called through the public API.

-- 2. Health-data consent --------------------------------------------------------------------------
alter table public.bookings add column if not exists health_consent_at timestamptz;

-- 3. Newsletter confirmation and unsubscribe -------------------------------------------------------
alter table public.newsletter_subscribers
  add column if not exists token text not null default encode(extensions.gen_random_bytes(24), 'hex'),
  add column if not exists confirmed_at timestamptz;

create unique index if not exists newsletter_subscribers_token_key on public.newsletter_subscribers (token);

-- Existing sign-ups were taken before confirmation existed; keep them subscribed.
update public.newsletter_subscribers set confirmed_at = consented_at where confirmed_at is null;

-- 1. Optional, per-attendee photo consent -----------------------------------------------------------
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
returns table(
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
set search_path to ''
as $function$
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
  v_all_photo boolean := true;
begin
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
    if coalesce((v_attendee->>'photo_consent')::boolean, false) is not true then
      v_all_photo := false;
    end if;

    if exists (
      select 1
      from public.registrations r
      where r.event_id = p_event_id
        and lower(r.email) = lower(p_email)
        and lower(r.attendee_name) = lower(v_name)
        and r.attendee_date_of_birth = v_dob
        and (r.status = 'paid' or (r.status = 'pending' and r.expires_at > now()))
    ) then
      raise exception 'already_booked:%', v_name;
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
    v_all_photo,
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
      coalesce((v_attendee->>'photo_consent')::boolean, false),
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
$function$;

-- 4. Delete safeguarding details 30 days after the event ------------------------------------------
create or replace function public.purge_old_safeguarding_data()
returns integer
language sql
security definer
set search_path to ''
as $$
  with purged as (
    update public.registrations r
    set medical_notes = null,
        emergency_contact_name = null,
        emergency_contact_phone = null,
        updated_at = now()
    from public.events e
    where e.id = r.event_id
      and coalesce(e.ends_at, e.starts_at) < now() - interval '30 days'
      and (r.medical_notes is not null or r.emergency_contact_name is not null or r.emergency_contact_phone is not null)
    returning 1
  ),
  unpaid as (
    -- Bookings that were never paid for don't need the attendee's date of birth.
    update public.registrations r
    set attendee_date_of_birth = null,
        medical_notes = null,
        emergency_contact_name = null,
        emergency_contact_phone = null,
        updated_at = now()
    where r.paid_at is null
      and r.status in ('pending', 'expired', 'cancelled')
      and r.created_at < now() - interval '30 days'
      and (r.attendee_date_of_birth is not null or r.medical_notes is not null
        or r.emergency_contact_name is not null or r.emergency_contact_phone is not null)
    returning 1
  )
  select ((select count(*) from purged) + (select count(*) from unpaid))::integer;
$$;

revoke all on function public.purge_old_safeguarding_data() from public, anon, authenticated;

create extension if not exists pg_cron;

select cron.unschedule('purge-safeguarding-data')
where exists (select 1 from cron.job where jobname = 'purge-safeguarding-data');

select cron.schedule('purge-safeguarding-data', '15 3 * * *', 'select public.purge_old_safeguarding_data()');

-- 5. Trigger functions are not API endpoints -------------------------------------------------------
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.link_admin_user() from public, anon, authenticated;
