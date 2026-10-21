import { db, Stripe, stripe } from "../_shared/clients.ts";
import { getSiteUrl, json, preflight, readJson, text, ValidationError } from "../_shared/http.ts";

const MAX_LINES = 20;
const MAX_QUANTITY = 10;

type AllowedCountry = Stripe.Checkout.SessionCreateParams.ShippingAddressCollection.AllowedCountry;

const shippingPence = Number(Deno.env.get("SHOP_SHIPPING_PENCE") ?? "0");
const shippingCountries = (Deno.env.get("SHOP_SHIPPING_COUNTRIES") ?? "GB")
  .split(",")
  .map((code) => code.trim().toUpperCase())
  .filter(Boolean) as AllowedCountry[];

type Product = {
  id: string;
  name: string;
  price_pence: number;
  currency: string;
  colours: string[];
  sizes: string[];
};

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

function checkOptions(line: CartLine, product: Product) {
  if (product.colours.length && (!line.colour || !product.colours.includes(line.colour))) {
    throw new ValidationError(`Please choose a colour for ${product.name}`);
  }
  if (product.sizes.length && (!line.size || !product.sizes.includes(line.size))) {
    throw new ValidationError(`Please choose a size for ${product.name}`);
  }
}

function optionLabel(line: CartLine): string {
  const colour = line.colour ? `${line.colour.charAt(0).toUpperCase()}${line.colour.slice(1)}` : null;
  return [colour, line.size && `Size ${line.size}`].filter(Boolean).join(" · ");
}

Deno.serve(async (req) => {
  const early = preflight(req);
  if (early) return early;

  const body = await readJson(req);
  if (!body) return json(req, { error: "Invalid request" }, 400);

  let cart: CartLine[];
  let products: Map<string, Product>;
  try {
    cart = parseCart(body);

    const ids = [...new Set(cart.map((line) => line.product_id))];
    const { data, error } = await db
      .from("products")
      .select("id, name, price_pence, currency, colours, sizes")
      .in("id", ids)
      .eq("is_active", true);
    if (error) throw error;

    products = new Map((data as Product[]).map((product) => [product.id, product]));
    for (const line of cart) {
      const product = products.get(line.product_id);
      if (!product) throw new ValidationError("One of the items in your bag is no longer available");
      checkOptions(line, product);
    }
  } catch (err) {
    if (err instanceof ValidationError) return json(req, { error: err.message }, 400);
    console.error("Failed to validate cart", err);
    return json(req, { error: "Couldn't start checkout. Please try again." }, 500);
  }

  const currencies = new Set([...products.values()].map((product) => product.currency));
  if (currencies.size !== 1) return json(req, { error: "Mixed currencies in one order aren't supported" }, 400);
  const currency = [...currencies][0];

  const subtotal = cart.reduce((sum, line) => sum + products.get(line.product_id)!.price_pence * line.quantity, 0);

  const { data: order, error: orderError } = await db
    .from("orders")
    .insert({ amount_subtotal_pence: subtotal, currency })
    .select("id")
    .single();
  if (orderError) {
    console.error("Failed to create order", orderError);
    return json(req, { error: "Couldn't start checkout. Please try again." }, 500);
  }
  const orderId = order.id as string;

  const { error: itemsError } = await db.from("order_items").insert(
    cart.map((line) => {
      const product = products.get(line.product_id)!;
      return {
        order_id: orderId,
        product_id: product.id,
        product_name: product.name,
        colour: line.colour,
        size: line.size,
        quantity: line.quantity,
        unit_price_pence: product.price_pence,
      };
    }),
  );
  if (itemsError) {
    console.error("Failed to save order items", itemsError);
    await db.from("orders").update({ status: "cancelled" }).eq("id", orderId);
    return json(req, { error: "Couldn't start checkout. Please try again." }, 500);
  }

  try {
    const metadata = { kind: "merch_order", order_id: orderId };
    const siteUrl = getSiteUrl();
    const session = await stripe.checkout.sessions.create(
      {
        mode: "payment",
        client_reference_id: orderId,
        line_items: cart.map((line) => {
          const product = products.get(line.product_id)!;
          const options = optionLabel(line);
          return {
            quantity: line.quantity,
            price_data: {
              currency,
              unit_amount: product.price_pence,
              product_data: options ? { name: product.name, description: options } : { name: product.name },
            },
          };
        }),
        shipping_address_collection: { allowed_countries: shippingCountries },
        ...(shippingPence > 0 && {
          shipping_options: [
            {
              shipping_rate_data: {
                type: "fixed_amount",
                display_name: "Delivery",
                fixed_amount: { amount: shippingPence, currency },
              },
            },
          ],
        }),
        phone_number_collection: { enabled: true },
        metadata,
        payment_intent_data: { metadata },
        success_url: `${siteUrl}/shop.html?order=success`,
        cancel_url: `${siteUrl}/shop.html?order=cancelled`,
      },
      { idempotencyKey: `order-${orderId}` },
    );

    const { error: updateError } = await db
      .from("orders")
      .update({ stripe_checkout_session_id: session.id })
      .eq("id", orderId);
    if (updateError) throw updateError;

    return json(req, { url: session.url });
  } catch (err) {
    console.error("Failed to create shop checkout", err);
    await db.from("orders").update({ status: "cancelled" }).eq("id", orderId);
    return json(req, { error: "Couldn't start payment. Please try again." }, 502);
  }
});
