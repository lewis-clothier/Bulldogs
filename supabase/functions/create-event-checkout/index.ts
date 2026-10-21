import { db, stripe } from "../_shared/clients.ts";
import { formatDate } from "../_shared/email.ts";
import { email, getSiteUrl, json, preflight, readJson, text, ValidationError } from "../_shared/http.ts";
import { sendRegistrationEmails } from "../_shared/notifications.ts";

// The place is held slightly longer than the Stripe session lives, so a late payment never loses its spot.
const HOLD_MINUTES = 40;
// Stripe requires checkout sessions to last at least 30 minutes.
const CHECKOUT_MINUTES = 31;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const reservationErrors: Record<string, [number, string]> = {
  event_not_found: [404, "That event isn't available to book."],
  signups_closed: [409, "Signups for this event have closed."],
  event_full: [409, "Sorry, this event is full."],
};

type Reservation = {
  registration_id: string;
  event_title: string;
  event_starts_at: string;
  amount_pence: number;
  currency: string;
};

function dateOfBirth(value: unknown): string | null {
  const raw = text(value, "Date of birth", 10);
  if (!raw) return null;
  const parsed = new Date(`${raw}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || Number.isNaN(parsed.getTime()) || parsed > new Date()) {
    throw new ValidationError("Date of birth is not valid");
  }
  return raw;
}

function parseBooking(body: Record<string, unknown>) {
  if (body.terms_accepted !== true) throw new ValidationError("Please accept the terms to book");

  const eventId = text(body.event_id, "Event", 36, true)!;
  if (!UUID.test(eventId)) throw new ValidationError("Event is not valid");

  const fullName = text(body.full_name, "Your name", 200, true)!;

  return {
    p_event_id: eventId,
    p_full_name: fullName,
    p_email: email(body.email),
    p_phone: text(body.phone, "Phone", 40),
    p_attendee_name: text(body.attendee_name, "Attendee name", 200) ?? fullName,
    p_attendee_date_of_birth: dateOfBirth(body.attendee_date_of_birth),
    p_emergency_contact_name: text(body.emergency_contact_name, "Emergency contact name", 200),
    p_emergency_contact_phone: text(body.emergency_contact_phone, "Emergency contact phone", 40),
    p_notes: text(body.notes, "Notes", 2000),
    p_newsletter_opt_in: body.newsletter_opt_in === true,
    p_hold_minutes: HOLD_MINUTES,
  };
}

Deno.serve(async (req) => {
  const early = preflight(req);
  if (early) return early;

  const body = await readJson(req);
  if (!body) return json(req, { error: "Invalid request" }, 400);

  let booking: ReturnType<typeof parseBooking>;
  try {
    booking = parseBooking(body);
  } catch (err) {
    if (err instanceof ValidationError) return json(req, { error: err.message }, 400);
    throw err;
  }

  const { data, error } = await db.rpc("reserve_event_place", booking).single();
  if (error) {
    const known = reservationErrors[error.message];
    if (known) return json(req, { error: known[1] }, known[0]);
    console.error("reserve_event_place failed", error);
    return json(req, { error: "Couldn't start your booking. Please try again." }, 500);
  }

  const reservation = data as Reservation;
  const registrationId = reservation.registration_id;
  const siteUrl = getSiteUrl();

  if (reservation.amount_pence === 0) {
    const { error: updateError } = await db
      .from("registrations")
      .update({ status: "paid", paid_at: new Date().toISOString(), expires_at: null })
      .eq("id", registrationId);
    if (updateError) {
      console.error("Failed to confirm free booking", updateError);
      return json(req, { error: "Couldn't confirm your booking. Please try again." }, 500);
    }
    await sendRegistrationEmails(registrationId);
    return json(req, { url: `${siteUrl}/events.html?booking=success` });
  }

  try {
    const metadata = { kind: "event_registration", registration_id: registrationId };
    const session = await stripe.checkout.sessions.create(
      {
        mode: "payment",
        customer_email: booking.p_email,
        client_reference_id: registrationId,
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: reservation.currency,
              unit_amount: reservation.amount_pence,
              product_data: {
                name: reservation.event_title,
                description: `${formatDate(reservation.event_starts_at)} · Attendee: ${booking.p_attendee_name}`,
              },
            },
          },
        ],
        metadata,
        payment_intent_data: { metadata },
        expires_at: Math.floor(Date.now() / 1000) + CHECKOUT_MINUTES * 60,
        success_url: `${siteUrl}/events.html?booking=success`,
        cancel_url: `${siteUrl}/events.html?booking=cancelled`,
      },
      { idempotencyKey: `registration-${registrationId}` },
    );

    const { error: updateError } = await db
      .from("registrations")
      .update({ stripe_checkout_session_id: session.id })
      .eq("id", registrationId);
    if (updateError) throw updateError;

    return json(req, { url: session.url });
  } catch (err) {
    console.error("Failed to create event checkout", err);
    await db.from("registrations").update({ status: "cancelled", expires_at: null }).eq("id", registrationId);
    return json(req, { error: "Couldn't start payment. Please try again." }, 502);
  }
});
