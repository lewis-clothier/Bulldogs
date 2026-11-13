import { canSelfCancel, isAdmin, requireUser } from "../_shared/auth.ts";
import { db, stripe } from "../_shared/clients.ts";
import { json, preflight, readJson, text, ValidationError } from "../_shared/http.ts";
import { recordNewsletter, sendBookingCancelled } from "../_shared/notifications.ts";

async function attachByEmail(userId: string, email: string) {
  await db.from("bookings").update({ user_id: userId }).is("user_id", null).eq("email", email);
  await db.from("registrations").update({ user_id: userId }).is("user_id", null).eq("email", email);
  await db.from("orders").update({ user_id: userId }).is("user_id", null).eq("customer_email", email);
  await db.from("newsletter_subscribers").update({ user_id: userId }).eq("email", email);
}

Deno.serve(async (req) => {
  const early = preflight(req);
  if (early) return early;

  try {
    const user = await requireUser(req);
    await attachByEmail(user.id, user.email);
    const body = await readJson(req);
    if (!body) return json(req, { error: "Invalid request" }, 400);
    const action = text(body.action, "Action", 40, true);

    if (action === "profile") {
      const { data: profile } = await db.from("profiles").select("*").eq("id", user.id).maybeSingle();
      const { data: sub } = await db.from("newsletter_subscribers").select("*").eq("email", user.email).maybeSingle();
      return json(req, {
        email: user.email,
        profile,
        newsletter: Boolean(sub && !sub.unsubscribed_at),
        is_admin: await isAdmin(user),
      });
    }

    if (action === "save_profile") {
      const fullName = text(body.full_name, "Name", 200);
      const phone = text(body.phone, "Phone", 40);
      await db.from("profiles").upsert({ id: user.id, full_name: fullName, phone });
      if (typeof body.newsletter_opt_in === "boolean") {
        await recordNewsletter(user.email, user.id, "account", body.newsletter_opt_in);
        if (!body.newsletter_opt_in) {
          await db.from("newsletter_subscribers").update({ unsubscribed_at: new Date().toISOString() }).eq("email", user.email);
        }
      }
      return json(req, { ok: true });
    }

    if (action === "subscribe_alerts") {
      await recordNewsletter(user.email, user.id, "event-alerts", true);
      return json(req, { ok: true, email: user.email });
    }

    if (action === "unsubscribe_alerts") {
      await recordNewsletter(user.email, user.id, "event-alerts", false);
      await db
        .from("newsletter_subscribers")
        .update({ unsubscribed_at: new Date().toISOString() })
        .eq("email", user.email);
      return json(req, { ok: true, email: user.email });
    }

    if (action === "bookings") {
      const { data, error } = await db
        .from("bookings")
        .select("*, event:events(title, starts_at, location, what_to_bring), attendees:registrations(id, attendee_name, checkin_token, status, checked_in_at)")
        .or(`user_id.eq.${user.id},email.eq.${user.email}`)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return json(req, { bookings: data });
    }

    if (action === "orders") {
      const { data, error } = await db
        .from("orders")
        .select("*, items:order_items(product_name, colour, size, quantity, unit_price_pence)")
        .or(`user_id.eq.${user.id},customer_email.eq.${user.email}`)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return json(req, { orders: data });
    }

    if (action === "cancel_booking") {
      const bookingId = text(body.booking_id, "Booking", 36, true)!;
      const { data: booking, error } = await db
        .from("bookings")
        .select("*, event:events(starts_at)")
        .eq("id", bookingId)
        .single();
      if (error || !booking) throw new ValidationError("Booking not found");
      if (booking.user_id !== user.id && booking.email !== user.email) throw new ValidationError("Booking not found");
      if (booking.status !== "paid") throw new ValidationError("Only a paid booking can be cancelled here");
      const startsAt = (booking.event as { starts_at: string }).starts_at;
      if (!canSelfCancel(startsAt)) throw new ValidationError("It's too close to the event to cancel online. Email the club.");
      let refunded = false;
      if (booking.stripe_payment_intent_id) {
        try {
          await stripe.refunds.create({ payment_intent: booking.stripe_payment_intent_id });
          refunded = true;
        } catch (err) {
          console.error("Refund failed", err);
          throw new ValidationError("Couldn't refund automatically. Email the club.");
        }
      }
      const status = refunded ? "refunded" : "cancelled";
      await db.from("bookings").update({ status, expires_at: null }).eq("id", bookingId);
      await db.from("registrations").update({ status, expires_at: null }).eq("booking_id", bookingId);
      await sendBookingCancelled(bookingId, refunded);
      return json(req, { ok: true });
    }

    if (action === "get_cart") {
      const { data } = await db.from("carts").select("items").eq("user_id", user.id).maybeSingle();
      return json(req, { items: data?.items ?? [] });
    }

    if (action === "save_cart") {
      const items = Array.isArray(body.items) ? body.items : [];
      await db.from("carts").upsert({
        user_id: user.id,
        items,
        abandoned_email_sent_at: null,
        updated_at: new Date().toISOString(),
      });
      return json(req, { ok: true });
    }

    return json(req, { error: "Unknown action" }, 400);
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (err instanceof ValidationError) return json(req, { error: err.message }, 400);
    if (status) return json(req, { error: (err as Error).message }, status);
    console.error(err);
    return json(req, { error: "Request failed" }, 500);
  }
});
