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

async function markPaid(session: Stripe.Checkout.Session) {
  const paidAt = new Date().toISOString();
  const intent = paymentIntentId(session.payment_intent);

  if (session.metadata?.kind === "event_registration") {
    const id = session.metadata.registration_id;
    const { data, error } = await db
      .from("registrations")
      .update({
        status: "paid",
        paid_at: paidAt,
        expires_at: null,
        stripe_checkout_session_id: session.id,
        stripe_payment_intent_id: intent,
      })
      .eq("id", id)
      .neq("status", "paid")
      .select("id");
    if (error) throw error;
    // An empty result means Stripe is retrying an event already handled, so don't email twice.
    if (data.length) await sendRegistrationEmails(id);
    return;
  }

  if (session.metadata?.kind === "merch_order") {
    const id = session.metadata.order_id;
    // Older Stripe API versions put shipping_details on the session itself.
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
    if (data.length) await sendOrderEmails(id);
  }
}

async function markUnpaid(session: Stripe.Checkout.Session, status: "expired" | "cancelled") {
  if (session.metadata?.kind === "event_registration") {
    const { error } = await db
      .from("registrations")
      .update({ status, expires_at: null })
      .eq("id", session.metadata.registration_id)
      .eq("status", "pending");
    if (error) throw error;
  } else if (session.metadata?.kind === "merch_order") {
    const { error } = await db
      .from("orders")
      .update({ status })
      .eq("id", session.metadata.order_id)
      .eq("status", "pending");
    if (error) throw error;
  }
}

async function markRefunded(charge: Stripe.Charge) {
  // Partial refunds leave the booking or order as it is.
  if (!charge.refunded) return;
  const intent = paymentIntentId(charge.payment_intent);
  if (!intent) return;

  for (const table of ["registrations", "orders"]) {
    const { error } = await db.from(table).update({ status: "refunded" }).eq("stripe_payment_intent_id", intent);
    if (error) throw error;
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
    // A non-2xx response makes Stripe retry the event later.
    console.error(`Failed to handle ${event.type} (${event.id})`, err);
    return new Response("Webhook handler failed", { status: 500 });
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { "Content-Type": "application/json" },
  });
});
