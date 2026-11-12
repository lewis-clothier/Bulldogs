import { canSelfCancel } from "../_shared/auth.ts";
import { db, stripe } from "../_shared/clients.ts";
import { email, json, preflight, readJson, text, ValidationError } from "../_shared/http.ts";
import { sendBookingCancelled } from "../_shared/notifications.ts";

function icsEscape(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
}

function toIcsDate(iso: string) {
  return new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const early = preflight(req, "GET, POST, OPTIONS");
  if (early) return early;

  try {
    if (req.method === "GET" && (url.searchParams.get("action") === "ics" || url.searchParams.get("ics"))) {
      const token = url.searchParams.get("c") || url.searchParams.get("token") || "";
      const { data: booking, error } = await db
        .from("bookings")
        .select("*, event:events(title, starts_at, ends_at, location, summary)")
        .eq("cancel_token", token)
        .maybeSingle();
      if (error || !booking) return json(req, { error: "Not found" }, 404, "GET, POST, OPTIONS");
      const event = booking.event as { title: string; starts_at: string; ends_at: string | null; location: string | null; summary: string | null };
      const ics = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Team Bulldogs//Events//EN",
        "BEGIN:VEVENT",
        `UID:${booking.id}@teambulldogs.co.uk`,
        `DTSTAMP:${toIcsDate(new Date().toISOString())}`,
        `DTSTART:${toIcsDate(event.starts_at)}`,
        `DTEND:${toIcsDate(event.ends_at ?? event.starts_at)}`,
        `SUMMARY:${icsEscape(event.title)}`,
        event.location ? `LOCATION:${icsEscape(event.location)}` : "",
        event.summary ? `DESCRIPTION:${icsEscape(event.summary)}` : "",
        "END:VEVENT",
        "END:VCALENDAR",
      ].filter(Boolean).join("\r\n");
      return new Response(ics, {
        headers: {
          "Content-Type": "text/calendar; charset=utf-8",
          "Content-Disposition": `attachment; filename="bulldogs-event.ics"`,
        },
      });
    }

    const body = req.method === "POST" ? await readJson(req) : {};
    if (!body) return json(req, { error: "Invalid request" }, 400, "GET, POST, OPTIONS");
    const action = text(body.action ?? url.searchParams.get("action"), "Action", 40, true);

    if (action === "ticket") {
      const token = text(body.token ?? url.searchParams.get("t") ?? url.searchParams.get("c"), "Token", 80, true)!;
      const { data: byCheckin } = await db
        .from("registrations")
        .select("id, attendee_name, checkin_token, status, event:events(title, starts_at, location, what_to_bring), booking:bookings(cancel_token, full_name, email, status)")
        .eq("checkin_token", token)
        .maybeSingle();
      if (byCheckin) return json(req, { attendees: [byCheckin] }, 200, "GET, POST, OPTIONS");

      const { data: booking } = await db
        .from("bookings")
        .select("id, cancel_token, full_name, email, status, event:events(title, starts_at, location, what_to_bring), attendees:registrations(id, attendee_name, checkin_token, status)")
        .eq("cancel_token", token)
        .maybeSingle();
      if (!booking) return json(req, { error: "Ticket not found" }, 404, "GET, POST, OPTIONS");
      return json(req, { booking, attendees: booking.attendees }, 200, "GET, POST, OPTIONS");
    }

    if (action === "cancel") {
      const token = text(body.token ?? body.cancel_token, "Token", 80, true)!;
      const { data: booking, error } = await db
        .from("bookings")
        .select("*, event:events(starts_at, title)")
        .eq("cancel_token", token)
        .single();
      if (error || !booking) throw new ValidationError("Booking not found");
      if (booking.status !== "paid") throw new ValidationError("This booking is not active");
      const startsAt = (booking.event as { starts_at: string }).starts_at;
      if (!canSelfCancel(startsAt)) throw new ValidationError("It's too close to the event to cancel online. Email the club.");
      let refunded = false;
      if (booking.stripe_payment_intent_id) {
        await stripe.refunds.create({ payment_intent: booking.stripe_payment_intent_id });
        refunded = true;
      }
      const status = refunded ? "refunded" : "cancelled";
      await db.from("bookings").update({ status, expires_at: null }).eq("id", booking.id);
      await db.from("registrations").update({ status, expires_at: null }).eq("booking_id", booking.id);
      await sendBookingCancelled(booking.id, refunded);
      return json(req, { ok: true, refunded }, 200, "GET, POST, OPTIONS");
    }

    if (action === "join_waitlist") {
      const eventId = text(body.event_id, "Event", 36, true)!;
      const address = email(body.email);
      const name = text(body.full_name, "Name", 200);
      const { data: event, error: eventError } = await db.from("events").select("id, is_published").eq("id", eventId).maybeSingle();
      if (eventError || !event?.is_published) throw new ValidationError("That event isn't open");
      const { error } = await db.from("event_waitlist").upsert(
        { event_id: eventId, email: address, full_name: name },
        { onConflict: "event_id,email" },
      );
      if (error) {
        console.error(error);
        const missing = error.code === "42P01" || error.code === "PGRST205";
        throw new ValidationError(missing ? "The waitlist isn't available yet." : "Couldn't join the waitlist.");
      }
      return json(req, { ok: true }, 200, "GET, POST, OPTIONS");
    }

    if (action === "subscribe_alerts") {
      const address = email(body.email);
      const { error } = await db.from("newsletter_subscribers").upsert({
        email: address,
        user_id: null,
        source: "event-alerts",
        consented_at: new Date().toISOString(),
        unsubscribed_at: null,
      });
      if (error) throw new ValidationError("Couldn't save that email.");
      return json(req, { ok: true }, 200, "GET, POST, OPTIONS");
    }

    return json(req, { error: "Unknown action" }, 400, "GET, POST, OPTIONS");
  } catch (err) {
    if (err instanceof ValidationError) return json(req, { error: err.message }, 400, "GET, POST, OPTIONS");
    console.error(err);
    return json(req, { error: "Request failed" }, 500, "GET, POST, OPTIONS");
  }
});
