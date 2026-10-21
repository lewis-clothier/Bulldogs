import { db } from "./clients.ts";
import { clubEmail, escapeHtml, formatDate, formatMoney, plain, sendTemplate } from "./email.ts";

type Address = {
  line1?: string | null;
  line2?: string | null;
  city?: string | null;
  state?: string | null;
  postal_code?: string | null;
  country?: string | null;
};

function formatAddress(address: Address | null): string | null {
  if (!address) return null;
  return plain(
    [address.line1, address.line2, address.city, address.state, address.postal_code, address.country]
      .filter(Boolean)
      .join(", "),
  );
}

function formatDateOnly(date: string | null): string | null {
  if (!date) return null;
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "long", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
}

const reference = (id: string) => id.slice(0, 8).toUpperCase();

export async function sendRegistrationEmails(registrationId: string) {
  const { data: r, error } = await db
    .from("registrations")
    .select("*, event:events(title, starts_at, location)")
    .eq("id", registrationId)
    .single();
  if (error) throw error;

  const event = r.event as { title: string; starts_at: string; location: string | null };
  const shared = {
    EVENT_TITLE: plain(event.title),
    EVENT_WHEN: formatDate(event.starts_at),
    ATTENDEE_NAME: plain(r.attendee_name),
    BOOKER_NAME: plain(r.full_name),
    AMOUNT_PAID: r.amount_pence > 0 ? formatMoney(r.amount_pence, r.currency) : "Free",
    BOOKING_REF: reference(r.id),
  };

  await sendTemplate({
    template: "booking-confirmation",
    to: r.email,
    idempotencyKey: `booking-confirmation/${r.id}`,
    variables: { ...shared, EVENT_LOCATION: plain(event.location) },
  });

  await sendTemplate({
    template: "booking-club-alert",
    to: clubEmail,
    replyTo: r.email,
    idempotencyKey: `booking-club-alert/${r.id}`,
    variables: {
      ...shared,
      ATTENDEE_DOB: formatDateOnly(r.attendee_date_of_birth),
      BOOKER_EMAIL: r.email,
      BOOKER_PHONE: plain(r.phone),
      EMERGENCY_CONTACT: plain([r.emergency_contact_name, r.emergency_contact_phone].filter(Boolean).join(" · ")),
      NOTES: plain(r.notes),
      NEWSLETTER: r.newsletter_opt_in ? "Yes" : "No",
    },
  });
}

export async function sendOrderEmails(orderId: string) {
  const { data: order, error } = await db
    .from("orders")
    .select("*, items:order_items(product_name, colour, size, quantity, unit_price_pence)")
    .eq("id", orderId)
    .single();
  if (error) throw error;

  const items = order.items as {
    product_name: string;
    colour: string | null;
    size: string | null;
    quantity: number;
    unit_price_pence: number;
  }[];

  const cell = "padding:8px 0;border-bottom:1px solid #e4e4de;vertical-align:top;";
  const itemsHtml = `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:8px 0 4px;">${items
    .map((item) => {
      const colour = item.colour ? `${item.colour.charAt(0).toUpperCase()}${item.colour.slice(1)}` : null;
      const options = [colour, item.size && `Size ${item.size}`].filter(Boolean).join(" · ");
      return `<tr><td style="${cell}"><strong>${item.quantity} × ${escapeHtml(item.product_name)}</strong>${
        options ? `<br /><span style="color:#5b6472;">${escapeHtml(options)}</span>` : ""
      }</td><td style="${cell}text-align:right;white-space:nowrap;">${escapeHtml(
        formatMoney(item.unit_price_pence * item.quantity, order.currency),
      )}</td></tr>`;
    })
    .join("")}</table>`;

  const shared = {
    ITEMS_HTML: itemsHtml,
    TOTAL: formatMoney(order.amount_total_pence ?? order.amount_subtotal_pence, order.currency),
    SHIP_TO: formatAddress(order.shipping_address) ?? "Not given",
    ORDER_REF: reference(order.id),
  };

  if (order.customer_email) {
    await sendTemplate({
      template: "order-confirmation",
      to: order.customer_email,
      idempotencyKey: `order-confirmation/${order.id}`,
      variables: { ...shared, CUSTOMER_NAME: plain(order.customer_name) },
    });
  }

  await sendTemplate({
    template: "order-club-alert",
    to: clubEmail,
    replyTo: order.customer_email ?? undefined,
    idempotencyKey: `order-club-alert/${order.id}`,
    variables: {
      ...shared,
      CUSTOMER_NAME: plain(order.customer_name),
      CUSTOMER_EMAIL: order.customer_email ?? "Not given",
      CUSTOMER_PHONE: plain(order.customer_phone),
      SHIPPING_PAID: formatMoney(order.amount_shipping_pence, order.currency),
    },
  });
}
