import { requireClub } from "../_shared/auth.ts";
import { db, stripe } from "../_shared/clients.ts";
import { escapeHtml, formatDate, formatMoney, sendHtml } from "../_shared/email.ts";
import { email, getSiteUrl, json, preflight, readJson, text, ValidationError } from "../_shared/http.ts";
import { sendBookingCancelled, sendClubCancelledEvent } from "../_shared/notifications.ts";

async function notifyEventLive(event: { id: string; title: string; starts_at: string; location: string | null }) {
  try {
    const { data, error } = await db.from("newsletter_subscribers").select("email").is("unsubscribed_at", null);
    if (error || !data?.length) return;
    const when = formatDate(event.starts_at);
    const where = event.location ? ` · ${event.location}` : "";
    const link = `${getSiteUrl()}/events.html`;
    for (const row of data) {
      await sendHtml({
        to: row.email,
        subject: `New Bulldogs event: ${event.title}`,
        idempotencyKey: `event-live/${event.id}/${row.email}/${event.starts_at}`,
        html: `<div style="font-family:Outfit,Segoe UI,sans-serif;color:#1e1e23;line-height:1.5;max-width:36rem;">
          <p>A new Team Bulldogs event is open for booking.</p>
          <p><strong>${escapeHtml(event.title)}</strong><br>${escapeHtml(when)}${escapeHtml(where)}</p>
          <p><a href="${escapeHtml(link)}">See events</a></p>
        </div>`,
      });
    }
  } catch (err) {
    console.error("event alerts failed", err);
  }
}

async function refundIntent(intentId: string | null) {
  if (!intentId) return false;
  try {
    await stripe.refunds.create({ payment_intent: intentId });
    return true;
  } catch (err) {
    console.error("Stripe refund failed", err);
    return false;
  }
}

async function cancelBooking(bookingId: string, doRefund: boolean) {
  const { data: booking, error } = await db.from("bookings").select("*").eq("id", bookingId).single();
  if (error || !booking) throw new ValidationError("Booking not found");
  if (booking.status === "cancelled" || booking.status === "expired") return booking;

  let refunded = false;
  if (doRefund && booking.status === "paid") refunded = await refundIntent(booking.stripe_payment_intent_id);

  const status = refunded ? "refunded" : "cancelled";
  await db.from("bookings").update({ status, expires_at: null }).eq("id", bookingId);
  await db.from("registrations").update({ status, expires_at: null }).eq("booking_id", bookingId);
  await sendBookingCancelled(bookingId, refunded);
  return { ...booking, status, refunded };
}

Deno.serve(async (req) => {
  const early = preflight(req);
  if (early) return early;

  try {
    const user = await requireClub(req);
    const body = await readJson(req);
    if (!body) return json(req, { error: "Invalid request" }, 400);
    const action = text(body.action, "Action", 40, true);

    if (action === "whoami") return json(req, { ok: true, email: user.email, is_admin: true });

    if (action === "list_events") {
      const { data, error } = await db.from("events").select("*").order("starts_at", { ascending: false });
      if (error) throw error;
      return json(req, { events: data });
    }

    if (action === "upsert_event") {
      const row = {
        title: text(body.title, "Title", 200, true)!,
        slug: text(body.slug, "Slug", 80, true)!,
        summary: text(body.summary, "Summary", 500),
        description: text(body.description, "Description", 5000),
        location: text(body.location, "Location", 300),
        starts_at: text(body.starts_at, "Starts", 40, true)!,
        ends_at: text(body.ends_at, "Ends", 40),
        price_pence: Number(body.price_pence ?? 0),
        currency: text(body.currency, "Currency", 3) ?? "gbp",
        capacity: body.capacity === null || body.capacity === "" ? null : Number(body.capacity),
        signups_close_at: text(body.signups_close_at, "Signups close", 40),
        is_published: body.is_published === true,
        is_signup_open: body.is_signup_open !== false,
        age_range: text(body.age_range, "Age range", 80),
        what_to_bring: text(body.what_to_bring, "What to bring", 500),
      };
      let id = typeof body.id === "string" && body.id ? body.id : "";
      let wasPublished = false;
      if (id) {
        const { data: existing } = await db.from("events").select("is_published").eq("id", id).maybeSingle();
        wasPublished = existing?.is_published === true;
        const { error } = await db.from("events").update(row).eq("id", id);
        if (error) throw error;
      } else {
        const { data, error } = await db.from("events").insert(row).select("id").single();
        if (error) throw error;
        id = data.id;
      }
      if (row.is_published && !wasPublished) {
        await notifyEventLive({ id, title: row.title, starts_at: row.starts_at, location: row.location });
      }
      return json(req, { ok: true, id });
    }

    if (action === "list_attendees") {
      const eventId = text(body.event_id, "Event", 36, true)!;
      const { data, error } = await db
        .from("registrations")
        .select("*, booking:bookings(status, email, full_name, amount_pence, currency)")
        .eq("event_id", eventId)
        .order("created_at");
      if (error) throw error;
      return json(req, { attendees: data });
    }

    if (action === "attendees_csv") {
      const eventId = text(body.event_id, "Event", 36, true)!;
      const { data, error } = await db
        .from("registrations")
        .select("*")
        .eq("event_id", eventId)
        .in("status", ["paid", "pending"]);
      if (error) throw error;
      const header = "attendee,dob,booker,email,phone,emergency,emergency_phone,medical,notes,status,checked_in";
      const lines = (data ?? []).map((row) =>
        [
          row.attendee_name,
          row.attendee_date_of_birth,
          row.full_name,
          row.email,
          row.phone,
          row.emergency_contact_name,
          row.emergency_contact_phone,
          row.medical_notes,
          row.notes,
          row.status,
          row.checked_in_at ?? "",
        ].map((value) => `"${String(value ?? "").replaceAll('"', '""')}"`).join(","),
      );
      return json(req, { csv: [header, ...lines].join("\n") });
    }

    if (action === "checkin") {
      const token = text(body.token, "Token", 80, true)!;
      const eventId = text(body.event_id, "Event", 36);
      const { data: person, error } = await db
        .from("registrations")
        .select("*, event:events(id, title, starts_at, ends_at)")
        .eq("checkin_token", token)
        .maybeSingle();
      if (error) throw error;
      if (!person) return json(req, { error: "Unknown ticket" }, 404);
      if (eventId && person.event_id !== eventId) return json(req, { error: "This ticket is for a different event." }, 409);
      if (person.status !== "paid") return json(req, { error: `This booking is ${person.status}` }, 409);
      const event = person.event as { starts_at: string; ends_at: string | null; title: string };
      const start = new Date(event.starts_at).getTime();
      const end = new Date(event.ends_at ?? event.starts_at).getTime() + 6 * 60 * 60 * 1000;
      if (Date.now() < start - 12 * 60 * 60 * 1000 || Date.now() > end) {
        return json(req, { error: "This ticket is not for a session happening now." }, 409);
      }
      if (person.checked_in_at) {
        return json(req, { already: true, attendee: person });
      }
      await db.from("registrations").update({ checked_in_at: new Date().toISOString() }).eq("id", person.id);
      return json(req, { ok: true, attendee: { ...person, checked_in_at: new Date().toISOString() } });
    }

    if (action === "search_attendee") {
      const eventId = text(body.event_id, "Event", 36, true)!;
      const q = text(body.query, "Search", 80, true)!.toLowerCase();
      const { data, error } = await db
        .from("registrations")
        .select("*")
        .eq("event_id", eventId)
        .eq("status", "paid");
      if (error) throw error;
      const matches = (data ?? []).filter((row) => row.attendee_name.toLowerCase().includes(q) || row.email.toLowerCase().includes(q));
      return json(req, { attendees: matches });
    }

    if (action === "cancel_booking") {
      const bookingId = text(body.booking_id, "Booking", 36, true)!;
      const result = await cancelBooking(bookingId, body.refund !== false);
      return json(req, { ok: true, booking: result });
    }

    if (action === "cancel_event") {
      const eventId = text(body.event_id, "Event", 36, true)!;
      const { data: event, error: eventError } = await db.from("events").select("*").eq("id", eventId).single();
      if (eventError || !event) throw new ValidationError("Event not found");
      const { data: paid } = await db.from("bookings").select("*").eq("event_id", eventId).eq("status", "paid");
      for (const booking of paid ?? []) {
        const refunded = await refundIntent(booking.stripe_payment_intent_id);
        await db.from("bookings").update({ status: refunded ? "refunded" : "cancelled", expires_at: null }).eq("id", booking.id);
        await db.from("registrations").update({ status: refunded ? "refunded" : "cancelled", expires_at: null }).eq("booking_id", booking.id);
        await sendClubCancelledEvent(
          booking.email,
          booking.full_name,
          event.title,
          formatDate(event.starts_at),
          formatMoney(booking.amount_pence, booking.currency),
        );
      }
      await db.from("bookings").update({ status: "cancelled", expires_at: null }).eq("event_id", eventId).eq("status", "pending");
      await db.from("registrations").update({ status: "cancelled", expires_at: null }).eq("event_id", eventId).eq("status", "pending");
      await db.from("events").update({ is_signup_open: false, is_published: false }).eq("id", eventId);
      return json(req, { ok: true, refunded: paid?.length ?? 0 });
    }

    if (action === "list_stock") {
      const { data, error } = await db.from("product_variants").select("*, product:products(name)").order("colour").order("size");
      if (error) throw error;
      return json(req, { variants: data });
    }

    if (action === "set_on_hand") {
      const productId = text(body.product_id, "Product", 64, true)!;
      const colour = text(body.colour, "Colour", 40, true)!;
      const size = text(body.size, "Size", 10, true)!;
      const onHand = Number(body.on_hand);
      if (!Number.isInteger(onHand) || onHand < 0) throw new ValidationError("on_hand must be 0 or more");
      const { error } = await db.from("product_variants").update({ on_hand: onHand }).eq("product_id", productId).eq("colour", colour).eq("size", size);
      if (error) throw error;
      return json(req, { ok: true });
    }

    if (action === "list_orders") {
      const { data, error } = await db
        .from("orders")
        .select("*, items:order_items(*)")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return json(req, { orders: data });
    }

    if (action === "fulfil_order") {
      const orderId = text(body.order_id, "Order", 36, true)!;
      const notes = text(body.fulfilment_notes, "Notes", 500);
      const { data: order, error } = await db.from("orders").select("*").eq("id", orderId).single();
      if (error || !order) throw new ValidationError("Order not found");
      if (order.status !== "paid") throw new ValidationError("Only paid orders can be marked fulfilled");
      await db.rpc("fulfil_shop_order_stock", { p_order_id: orderId });
      await db.from("orders").update({
        status: "fulfilled",
        fulfilled_at: new Date().toISOString(),
        fulfilment_notes: notes,
      }).eq("id", orderId);
      return json(req, { ok: true });
    }

    if (action === "refund_order") {
      const orderId = text(body.order_id, "Order", 36, true)!;
      const { data: order, error } = await db.from("orders").select("*").eq("id", orderId).single();
      if (error || !order) throw new ValidationError("Order not found");
      if (order.status === "fulfilled") throw new ValidationError("Fulfilled orders are not auto-refunded");
      if (order.status !== "paid") throw new ValidationError("Only paid orders can be refunded");
      const refunded = await refundIntent(order.stripe_payment_intent_id);
      if (!refunded) throw new ValidationError("Stripe refund failed");
      await db.from("orders").update({ status: "refunded" }).eq("id", orderId);
      return json(req, { ok: true });
    }

    if (action === "list_admins") {
      const { data, error } = await db.from("admins").select("email, user_id, created_at").order("created_at");
      if (error) throw error;
      return json(req, { admins: data });
    }

    if (action === "grant_admin") {
      const address = email(body.email);
      const { data: existing } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
      const match = existing.users.find((item) => item.email?.toLowerCase() === address);
      const { error } = await db.from("admins").upsert({
        email: address,
        user_id: match?.id ?? null,
        granted_by: user.id,
      });
      if (error) throw error;
      return json(req, { ok: true });
    }

    if (action === "revoke_admin") {
      const address = email(body.email);
      const { count } = await db.from("admins").select("email", { count: "exact", head: true });
      if ((count ?? 0) <= 1) throw new ValidationError("Keep at least one admin.");
      if (address === user.email) throw new ValidationError("You can't remove your own admin access.");
      const { error } = await db.from("admins").delete().eq("email", address);
      if (error) throw error;
      return json(req, { ok: true });
    }

    if (action === "list_waitlist") {
      const { data, error } = await db
        .from("event_waitlist")
        .select("event_id, email, full_name, created_at")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return json(req, { rows: data });
    }

    if (action === "undo_checkin") {
      const registrationId = text(body.registration_id, "Registration", 36, true)!;
      const { error } = await db.from("registrations").update({ checked_in_at: null }).eq("id", registrationId);
      if (error) throw error;
      return json(req, { ok: true });
    }

    if (action === "summary") {
      const now = new Date().toISOString();
      const { count: live, error: liveError } = await db
        .from("events")
        .select("id", { count: "exact", head: true })
        .eq("is_published", true)
        .gt("starts_at", now);
      if (liveError) throw liveError;
      const { data: upcoming, error: upcomingError } = await db.from("events").select("id").gt("starts_at", now);
      if (upcomingError) throw upcomingError;
      const ids = (upcoming ?? []).map((row) => row.id);
      let booked = 0;
      if (ids.length) {
        const { count, error: placesError } = await db
          .from("registrations")
          .select("id", { count: "exact", head: true })
          .eq("status", "paid")
          .in("event_id", ids);
        if (placesError) throw placesError;
        booked = count ?? 0;
      }
      const { data: orders, error: ordersError } = await db
        .from("orders")
        .select("status, amount_total_pence, amount_subtotal_pence, amount_shipping_pence");
      if (ordersError) throw ordersError;
      const revenue = (orders ?? [])
        .filter((order) => order.status === "paid" || order.status === "fulfilled")
        .reduce((sum, order) => sum + (order.amount_total_pence ?? (order.amount_subtotal_pence || 0) + (order.amount_shipping_pence || 0)), 0);
      const toFulfil = (orders ?? []).filter((order) => order.status === "paid").length;
      return json(req, {
        live_events: live ?? 0,
        booked_places: booked,
        revenue_pence: revenue,
        orders_to_fulfil: toFulfil,
      });
    }

    if (action === "newsletter_csv") {
      const { data, error } = await db
        .from("newsletter_subscribers")
        .select("email, source, consented_at, unsubscribed_at")
        .is("unsubscribed_at", null)
        .order("consented_at", { ascending: false });
      if (error) throw error;
      const csv = ["email,source,consented_at", ...(data ?? []).map((row) => `${row.email},${row.source},${row.consented_at}`)].join("\n");
      return json(req, { csv });
    }

    return json(req, { error: "Unknown action" }, 400);
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (err instanceof ValidationError) return json(req, { error: err.message }, 400);
    if (status) return json(req, { error: (err as Error).message }, status);
    console.error(err);
    return json(req, { error: "Club request failed" }, 500);
  }
});
