import { db } from "../_shared/clients.ts";
import { formatDate } from "../_shared/email.ts";
import { json } from "../_shared/http.ts";
import { sendCartReminder, sendDayBeforeReminder, sendUnpaidReminder } from "../_shared/notifications.ts";

function authorized(req: Request) {
  const secret = Deno.env.get("CRON_SECRET");
  if (!secret) return false;
  return req.headers.get("x-cron-secret") === secret || req.headers.get("Authorization") === `Bearer ${secret}`;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  if (!authorized(req)) return json(req, { error: "Unauthorized" }, 401);

  const now = Date.now();
  const twentyMinAgo = new Date(now - 20 * 60 * 1000).toISOString();
  let unpaid = 0;
  let carts = 0;
  let dayBefore = 0;

  const { data: pendingBookings } = await db
    .from("bookings")
    .select("id, email, full_name, stripe_checkout_url, expires_at, event:events(title)")
    .eq("status", "pending")
    .is("abandoned_email_sent_at", null)
    .lt("created_at", twentyMinAgo)
    .gt("expires_at", new Date().toISOString());

  for (const booking of pendingBookings ?? []) {
    if (!booking.email || !booking.stripe_checkout_url) continue;
    const title = (booking.event as { title: string } | null)?.title ?? "your event";
    await sendUnpaidReminder(
      booking.email,
      booking.full_name,
      title,
      booking.stripe_checkout_url,
      booking.expires_at ? formatDate(booking.expires_at) : "soon",
    );
    await db.from("bookings").update({ abandoned_email_sent_at: new Date().toISOString() }).eq("id", booking.id);
    unpaid++;
  }

  const { data: pendingOrders } = await db
    .from("orders")
    .select("id, customer_email, customer_name, stripe_checkout_url")
    .eq("status", "pending")
    .is("abandoned_email_sent_at", null)
    .not("customer_email", "is", null)
    .lt("created_at", twentyMinAgo);

  for (const order of pendingOrders ?? []) {
    if (!order.customer_email || !order.stripe_checkout_url) continue;
    await sendUnpaidReminder(
      order.customer_email,
      order.customer_name ?? "there",
      "your merch order",
      order.stripe_checkout_url,
      "the checkout expires",
      Deno.env.get("RESEND_FROM_ORDERS") ?? "Team Bulldogs <orders@teambulldogs.co.uk>",
    );
    await db.from("orders").update({ abandoned_email_sent_at: new Date().toISOString() }).eq("id", order.id);
    unpaid++;
  }

  const { data: leftoverCarts } = await db
    .from("carts")
    .select("user_id, items, abandoned_email_sent_at, updated_at")
    .is("abandoned_email_sent_at", null)
    .lt("updated_at", twentyMinAgo);

  for (const cart of leftoverCarts ?? []) {
    if (!Array.isArray(cart.items) || cart.items.length === 0) continue;
    const { data: profile } = await db.from("profiles").select("full_name").eq("id", cart.user_id).maybeSingle();
    const { data: user } = await db.auth.admin.getUserById(cart.user_id);
    const email = user.user?.email;
    if (!email) continue;
    await sendCartReminder(email, profile?.full_name ?? "there");
    await db.from("carts").update({ abandoned_email_sent_at: new Date().toISOString() }).eq("user_id", cart.user_id);
    carts++;
  }

  const from = new Date(now + 20 * 60 * 60 * 1000).toISOString();
  const to = new Date(now + 30 * 60 * 60 * 1000).toISOString();
  const { data: upcoming } = await db
    .from("bookings")
    .select("id, event:events(starts_at)")
    .eq("status", "paid")
    .is("day_before_email_sent_at", null);

  for (const booking of upcoming ?? []) {
    const starts = (booking.event as { starts_at: string } | null)?.starts_at;
    if (!starts || starts < from || starts > to) continue;
    await sendDayBeforeReminder(booking.id);
    await db.from("bookings").update({ day_before_email_sent_at: new Date().toISOString() }).eq("id", booking.id);
    dayBefore++;
  }

  return json(req, { ok: true, unpaid, carts, dayBefore });
});
