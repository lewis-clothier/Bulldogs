-- Duplicate attendee guard: same event + booker email + name + date of birth
-- (not name alone), so different kids with the same name under one email can book.

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
$function$;
