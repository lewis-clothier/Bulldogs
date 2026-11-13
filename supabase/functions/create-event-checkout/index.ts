import { maybeCreateAccount, getUser, reference } from "../_shared/auth.ts";
import { db, stripe } from "../_shared/clients.ts";
import { formatDate } from "../_shared/email.ts";
import { checkoutSiteUrl, email, json, preflight, readJson, text, ValidationError } from "../_shared/http.ts";
import { recordNewsletter, sendRegistrationEmails } from "../_shared/notifications.ts";

const HOLD_MINUTES = 40;
const CHECKOUT_MINUTES = 31;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const reservationErrors: Record<string, [number, string]> = {
  event_not_found: [404, "That event isn't available to book."],
  signups_closed: [409, "Signups for this event have closed."],
  event_full: [409, "Sorry, this event is full."],
  photo_consent_required: [400, "Please confirm photo and video consent."],
  attendees_required: [400, "Add at least one attendee."],
  attendee_name_required: [400, "Each attendee needs a name."],
  attendee_dob_required: [400, "Each attendee needs a date of birth."],
  attendee_dob_invalid: [400, "Date of birth is not valid."],
  emergency_contact_required: [400, "Each attendee needs an emergency contact name and phone."],
  already_booked: [409, "That person is already booked on this event."],
  guardian_required: [400, "A parent or guardian must confirm for under-18s."],
};

type Reservation = {
  booking_id: string;
  cancel_token: string;
  event_title: string;
  event_starts_at: string;
  event_location: string | null;
  event_what_to_bring: string | null;
  amount_pence: number;
  currency: string;
  place_count: number;
};

function dateOfBirth(value: unknown): string {
  const raw = text(value, "Date of birth", 10, true)!;
  const parsed = new Date(`${raw}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || Number.isNaN(parsed.getTime()) || parsed >= new Date()) {
    throw new ValidationError("Date of birth is not valid");
  }
  return raw;
}

function parseAttendees(value: unknown) {
  if (!Array.isArray(value) || value.length === 0) throw new ValidationError("Add at least one attendee");
  if (value.length > 8) throw new ValidationError("You can book at most 8 places at once");
  return value.map((item, index) => {
    if (!item || typeof item !== "object") throw new ValidationError(`Attendee ${index + 1} is not valid`);
    const row = item as Record<string, unknown>;
    const name = text(row.name ?? row.attendee_name, `Attendee ${index + 1} name`, 200, true)!;
    return {
      name,
      date_of_birth: dateOfBirth(row.date_of_birth ?? row.attendee_date_of_birth),
      emergency_contact_name: text(row.emergency_contact_name, "Emergency contact name", 200, true)!,
      emergency_contact_phone: text(row.emergency_contact_phone, "Emergency contact phone", 40, true)!,
      medical_notes: text(row.medical_notes, "Medical notes", 2000),
      notes: text(row.notes, "Notes", 2000),
    };
  });
}

Deno.serve(async (req) => {
  const early = preflight(req);
  if (early) return early;

  const body = await readJson(req);
  if (!body) return json(req, { error: "Invalid request" }, 400);

  try {
    if (body.terms_accepted !== true) throw new ValidationError("Please accept the terms to book");
    if (body.photo_consent !== true) throw new ValidationError("Please confirm photo and video consent");

    const eventId = text(body.event_id, "Event", 36, true)!;
    if (!UUID.test(eventId)) throw new ValidationError("Event is not valid");

    const fullName = text(body.full_name, "Your name", 200, true)!;
    const bookerEmail = email(body.email);
    const signedIn = await getUser(req);
    const password = text(body.password, "Password", 72);
    let userId = signedIn?.id ?? null;
    if (!userId && body.create_account === true && password) {
      if (password.length < 6) throw new ValidationError("Password must be at least 6 characters");
      userId = await maybeCreateAccount(bookerEmail, password, fullName);
    }

    const attendees = parseAttendees(body.attendees);
    const { data, error } = await db.rpc("reserve_event_place", {
      p_event_id: eventId,
      p_full_name: fullName,
      p_email: bookerEmail,
      p_phone: text(body.phone, "Phone", 40),
      p_attendees: attendees,
      p_newsletter_opt_in: body.newsletter_opt_in === true,
      p_photo_consent: true,
      p_guardian_confirmed: body.guardian_confirmed === true,
      p_user_id: userId,
      p_hold_minutes: HOLD_MINUTES,
    }).single();

    if (error) {
      const knownKey = Object.keys(reservationErrors).find((key) => (error.message || "").includes(key));
      const known = knownKey ? reservationErrors[knownKey] : undefined;
      if (known) return json(req, { error: known[1] }, known[0]);
      console.error("reserve_event_place failed", error);
      return json(req, { error: "Couldn't start your booking. Please try again." }, 500);
    }

    const reservation = data as Reservation;
    await recordNewsletter(bookerEmail, userId, "event-checkout", body.newsletter_opt_in === true);

    const siteUrl = checkoutSiteUrl(req);
    const bookingRef = reference(reservation.booking_id);
    const ticketCode = encodeURIComponent(reservation.cancel_token);
    const successUrl =
      `${siteUrl}/confirm.html?type=event&ref=${bookingRef}&c=${ticketCode}&booking=success#type=event&ref=${bookingRef}&c=${ticketCode}&booking=success`;

    if (reservation.amount_pence === 0) {
      const paidAt = new Date().toISOString();
      await db.from("bookings").update({ status: "paid", paid_at: paidAt, expires_at: null }).eq("id", reservation.booking_id);
      await db.from("registrations").update({ status: "paid", paid_at: paidAt, expires_at: null }).eq("booking_id", reservation.booking_id);
      await sendRegistrationEmails(reservation.booking_id);
      return json(req, { url: successUrl });
    }

    try {
      const metadata = { kind: "event_registration", booking_id: reservation.booking_id };
      const session = await stripe.checkout.sessions.create(
        {
          mode: "payment",
          customer_email: bookerEmail,
          client_reference_id: reservation.booking_id,
          line_items: [
            {
              quantity: reservation.place_count,
              price_data: {
                currency: reservation.currency,
                unit_amount: Math.round(reservation.amount_pence / reservation.place_count),
                product_data: {
                  name: reservation.event_title,
                  description: `${formatDate(reservation.event_starts_at)} · ${reservation.place_count} place${reservation.place_count === 1 ? "" : "s"}`,
                },
              },
            },
          ],
          metadata,
          payment_intent_data: { metadata },
          expires_at: Math.floor(Date.now() / 1000) + CHECKOUT_MINUTES * 60,
          success_url: successUrl,
          cancel_url: `${siteUrl}/events.html?booking=cancelled`,
        },
        { idempotencyKey: `booking-${reservation.booking_id}` },
      );

      await db.from("bookings").update({
        stripe_checkout_session_id: session.id,
        stripe_checkout_url: session.url,
      }).eq("id", reservation.booking_id);

      return json(req, { url: session.url });
    } catch (err) {
      console.error("Failed to create event checkout", err);
      await db.from("bookings").update({ status: "cancelled", expires_at: null }).eq("id", reservation.booking_id);
      await db.from("registrations").update({ status: "cancelled", expires_at: null }).eq("booking_id", reservation.booking_id);
      return json(req, { error: "Couldn't start payment. Please try again." }, 502);
    }
  } catch (err) {
    if (err instanceof ValidationError) return json(req, { error: err.message }, 400);
    throw err;
  }
});
