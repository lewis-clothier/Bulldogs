import { getUser, maybeCreateAccount, reference } from "../_shared/auth.ts";
import { db, Stripe, stripe } from "../_shared/clients.ts";
import { checkoutSiteUrl, email, json, preflight, readJson, text, ValidationError } from "../_shared/http.ts";
import { recordNewsletter } from "../_shared/notifications.ts";

const MAX_LINES = 20;
const MAX_QUANTITY = 10;

type AllowedCountry = Stripe.Checkout.SessionCreateParams.ShippingAddressCollection.AllowedCountry;

const shippingPence = Number(Deno.env.get("SHOP_SHIPPING_PENCE") ?? "495");
const shippingCountries = (Deno.env.get("SHOP_SHIPPING_COUNTRIES") ?? "GB")
  .split(",")
  .map((code) => code.trim().toUpperCase())
  .filter(Boolean) as AllowedCountry[];

type CartLine = { product_id: string; colour: string | null; size: string | null; quantity: number };

function parseCart(body: Record<string, unknown>): CartLine[] {
  const items = body.items;
  if (!Array.isArray(items) || items.length === 0) throw new ValidationError("Your bag is empty");
  if (items.length > MAX_LINES) throw new ValidationError("Too many items in your bag");

  return items.map((item) => {
    if (!item || typeof item !== "object") throw new ValidationError("Invalid item");
    const line = item as Record<string, unknown>;
    const quantity = Number(line.quantity);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) {
      throw new ValidationError(`Quantity must be between 1 and ${MAX_QUANTITY}`);
    }
    return {
      product_id: text(line.product_id, "Product", 64, true)!,
      colour: text(line.colour, "Colour", 40)?.toLowerCase() ?? null,
      size: text(line.size, "Size", 10)?.toUpperCase() ?? null,
      quantity,
    };
  });
}

Deno.serve(async (req) => {
  const early = preflight(req);
  if (early) return early;

  const body = await readJson(req);
  if (!body) return json(req, { error: "Invalid request" }, 400);

  try {
    const cart = parseCart(body);
    const customerEmail = email(body.email);
    const signedIn = await getUser(req);
    const password = text(body.password, "Password", 72);
    const fullName = text(body.full_name, "Your name", 200);
    let userId = signedIn?.id ?? null;
    if (!userId && body.create_account === true && password) {
      if (password.length < 6) throw new ValidationError("Password must be at least 6 characters");
      userId = await maybeCreateAccount(customerEmail, password, fullName);
    }

    const { data: orderId, error } = await db.rpc("create_shop_order", {
      p_user_id: userId,
      p_email: customerEmail,
      p_newsletter_opt_in: body.newsletter_opt_in === true,
      p_items: cart,
    });
    if (error) {
      const message = error.message || "";
      if (message.includes("out_of_stock")) return json(req, { error: "Sorry, that size/colour has sold out." }, 409);
      if (message.includes("item_unavailable") || message.includes("bag_empty")) {
        return json(req, { error: "One of the items in your bag is no longer available." }, 400);
      }
      console.error("create_shop_order failed", error);
      return json(req, { error: "Couldn't start checkout. Please try again." }, 500);
    }

    const id = orderId as string;
    if (fullName) await db.from("orders").update({ customer_name: fullName }).eq("id", id);
    await recordNewsletter(customerEmail, userId, "shop-checkout", body.newsletter_opt_in === true);

    const { data: items, error: itemsError } = await db
      .from("order_items")
      .select("product_name, colour, size, quantity, unit_price_pence")
      .eq("order_id", id);
    if (itemsError || !items?.length) {
      await db.rpc("release_shop_order_stock", { p_order_id: id });
      return json(req, { error: "Couldn't start checkout. Please try again." }, 500);
    }

    const { data: order } = await db.from("orders").select("currency, amount_subtotal_pence").eq("id", id).single();
    const currency = order?.currency ?? "gbp";
    const siteUrl = checkoutSiteUrl(req);

    try {
      const metadata = { kind: "merch_order", order_id: id };
      const session = await stripe.checkout.sessions.create(
        {
          mode: "payment",
          customer_email: customerEmail,
          client_reference_id: id,
          line_items: items.map((line) => {
            const colour = line.colour ? `${line.colour.charAt(0).toUpperCase()}${line.colour.slice(1)}` : null;
            const options = [colour, line.size && `Size ${line.size}`].filter(Boolean).join(" · ");
            return {
              quantity: line.quantity,
              price_data: {
                currency,
                unit_amount: line.unit_price_pence,
                product_data: options ? { name: line.product_name, description: options } : { name: line.product_name },
              },
            };
          }),
          shipping_address_collection: { allowed_countries: shippingCountries },
          ...(shippingPence > 0 && {
            shipping_options: [
              {
                shipping_rate_data: {
                  type: "fixed_amount" as const,
                  display_name: "UK delivery",
                  fixed_amount: { amount: shippingPence, currency },
                },
              },
            ],
          }),
          phone_number_collection: { enabled: true },
          metadata,
          payment_intent_data: { metadata },
          success_url: `${siteUrl}/confirm.html?type=order&ref=${reference(id)}&order=success#type=order&ref=${reference(id)}&order=success`,
          cancel_url: `${siteUrl}/shop.html?order=cancelled`,
        },
        { idempotencyKey: `order-${id}` },
      );

      await db.from("orders").update({
        stripe_checkout_session_id: session.id,
        stripe_checkout_url: session.url,
      }).eq("id", id);

      if (userId) {
        await db.from("carts").upsert({
          user_id: userId,
          items: [],
          abandoned_email_sent_at: null,
          updated_at: new Date().toISOString(),
        });
      }

      return json(req, { url: session.url });
    } catch (err) {
      console.error("Failed to create shop checkout", err);
      await db.rpc("release_shop_order_stock", { p_order_id: id });
      await db.from("orders").update({ status: "cancelled" }).eq("id", id);
      return json(req, { error: "Couldn't start payment. Please try again." }, 502);
    }
  } catch (err) {
    if (err instanceof ValidationError) return json(req, { error: err.message }, 400);
    console.error("Shop checkout failed", err);
    return json(req, { error: "Couldn't start checkout. Please try again." }, 500);
  }
});
