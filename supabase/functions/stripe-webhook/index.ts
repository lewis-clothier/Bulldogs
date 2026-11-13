import { db, Stripe, stripe } from "../_shared/clients.ts";
import { requireEnv } from "../_shared/http.ts";
import { sendOrderEmails, sendRegistrationEmails } from "../_shared/notifications.ts";

const webhookSecret = requireEnv("STRIPE_WEBHOOK_SECRET");
const cryptoProvider = Stripe.createSubtleCryptoProvider();

type ShippingDetails = { name?: string | null; address?: Stripe.Address | null } | null | undefined;

function paymentIntentId(value: string | { id: string } | null | undefined): string | null {
  if (!value) return null;
  return typeof value === "string" ? value : value.id;
}

async function markBooking(bookingId: string, status: "paid" | "expired" | "cancelled", extra: Record<string, unknown> = {}) {
  const { data, error } = await db
    .from("bookings")
    .update({ status, expires_at: null, ...extra })
    .eq("id", bookingId)
    .neq("status", "paid")
    .select("id");
  if (error) throw error;
  const registrationPatch: Record<string, unknown> = { status, expires_at: null };
  if (extra.paid_at) registrationPatch.paid_at = extra.paid_at;
  if (extra.stripe_payment_intent_id) registrationPatch.stripe_payment_intent_id = extra.stripe_payment_intent_id;
  await db.from("registrations").update(registrationPatch).eq("booking_id", bookingId).neq("status", "paid");
  return data?.length ?? 0;
}

async function markPaid(session: Stripe.Checkout.Session) {
  const paidAt = new Date().toISOString();
  const intent = paymentIntentId(session.payment_intent);
  const kind = session.metadata?.kind;
  const bookingId = session.metadata?.booking_id;
  const registrationId = session.metadata?.registration_id;
  const orderId = session.metadata?.order_id;

  if (kind === "event_registration" || bookingId || registrationId) {
    let id = bookingId;
    if (!id && registrationId) {
      const { data } = await db.from("registrations").select("booking_id").eq("id", registrationId).maybeSingle();
      id = data?.booking_id ?? registrationId;
    }
    if (!id) return;
    const updated = await markBooking(id, "paid", {
      paid_at: paidAt,
      stripe_checkout_session_id: session.id,
      stripe_payment_intent_id: intent,
    });
    if (updated) await sendRegistrationEmails(id);
    return;
  }

  if (kind === "merch_order" || orderId) {
    const id = orderId;
    if (!id) return;
    const shipping: ShippingDetails =
      session.collected_information?.shipping_details ??
      (session as unknown as { shipping_details?: ShippingDetails }).shipping_details;

    const { data, error } = await db
      .from("orders")
      .update({
        status: "paid",
        paid_at: paidAt,
        customer_name: shipping?.name ?? session.customer_details?.name ?? null,
        customer_email: session.customer_details?.email ?? null,
        customer_phone: session.customer_details?.phone ?? null,
        shipping_address: shipping?.address ?? session.customer_details?.address ?? null,
        amount_shipping_pence: session.total_details?.amount_shipping ?? 0,
        amount_total_pence: session.amount_total,
        stripe_checkout_session_id: session.id,
        stripe_payment_intent_id: intent,
      })
      .eq("id", id)
      .in("status", ["pending", "expired", "cancelled"])
      .select("id");
    if (error) throw error;
    // Reserved stay held until the order is marked fulfilled.
    if (data.length) await sendOrderEmails(id);
  }
}

async function markUnpaid(session: Stripe.Checkout.Session, status: "expired" | "cancelled") {
  const bookingId = session.metadata?.booking_id;
  const registrationId = session.metadata?.registration_id;
  const orderId = session.metadata?.order_id;

  if (session.metadata?.kind === "event_registration" || bookingId || registrationId) {
    let id = bookingId;
    if (!id && registrationId) {
      const { data } = await db.from("registrations").select("booking_id").eq("id", registrationId).maybeSingle();
      id = data?.booking_id ?? undefined;
    }
    if (id) await markBooking(id, status);
    return;
  }

  if ((session.metadata?.kind === "merch_order" || orderId) && orderId) {
    const { data, error } = await db
      .from("orders")
      .update({ status })
      .eq("id", orderId)
      .eq("status", "pending")
      .select("id");
    if (error) throw error;
    if (data.length) await db.rpc("release_shop_order_stock", { p_order_id: orderId });
  }
}

async function markRefunded(charge: Stripe.Charge) {
  if (!charge.refunded) return;
  const intent = paymentIntentId(charge.payment_intent);
  if (!intent) return;

  const { data: booking } = await db.from("bookings").update({ status: "refunded" }).eq("stripe_payment_intent_id", intent).select("id");
  if (booking?.length) {
    await db.from("registrations").update({ status: "refunded" }).eq("booking_id", booking[0].id);
  }

  const { data: order } = await db.from("orders").select("id, status").eq("stripe_payment_intent_id", intent).maybeSingle();
  if (order && order.status === "pending") {
    await db.rpc("release_shop_order_stock", { p_order_id: order.id });
    await db.from("orders").update({ status: "refunded" }).eq("id", order.id);
  } else if (order && (order.status === "paid" || order.status === "fulfilled")) {
    // paid → release reserved; fulfilled → put counted stock back (trigger).
    await db.from("orders").update({ status: "refunded" }).eq("id", order.id);
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const signature = req.headers.get("Stripe-Signature");
  if (!signature) return new Response("Missing Stripe-Signature header", { status: 400 });

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      await req.text(),
      signature,
      webhookSecret,
      undefined,
      cryptoProvider,
    );
  } catch (err) {
    console.error("Stripe signature verification failed", err);
    return new Response("Invalid signature", { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded":
        if (event.data.object.payment_status === "paid") await markPaid(event.data.object);
        break;
      case "checkout.session.expired":
        await markUnpaid(event.data.object, "expired");
        break;
      case "checkout.session.async_payment_failed":
        await markUnpaid(event.data.object, "cancelled");
        break;
      case "charge.refunded":
        await markRefunded(event.data.object);
        break;
    }
  } catch (err) {
    console.error(`Failed to handle ${event.type} (${event.id})`, err);
    return new Response("Webhook handler failed", { status: 500 });
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { "Content-Type": "application/json" },
  });
});
