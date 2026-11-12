import QRCode from "npm:qrcode@1.5.4";
import { canSelfCancel, reference } from "./auth.ts";
import { db } from "./clients.ts";
import { clubEmail, escapeHtml, formatDate, formatMoney, fromOrders, plain, sendHtml, sendTemplate, type MailAttachment } from "./email.ts";
import { getSiteUrl } from "./http.ts";

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

function wrap(body: string) {
  return `<div style="font-family:Outfit,Segoe UI,sans-serif;color:#1e1e23;line-height:1.5;max-width:36rem;">${body}</div>`;
}

function ticketLink(site: string, key: "t" | "c", token: string) {
  const value = encodeURIComponent(token);
  return `${site}/ticket.html?${key}=${value}#${key}=${value}`;
}

async function qrPng(data: string): Promise<string | null> {
  try {
    const buf = await QRCode.toBuffer(data, { type: "png", width: 360, margin: 1, errorCorrectionLevel: "M" });
    const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return btoa(binary);
  } catch (err) {
    console.error("QR render failed", err);
    return null;
  }
}

async function doorCodes(site: string, attendees: { attendee_name: string; checkin_token: string }[]) {
  const attachments: MailAttachment[] = [];
  const blocks: string[] = [];
  for (let i = 0; i < attendees.length; i++) {
    const person = attendees[i];
    if (!person.checkin_token) continue;
    const personTicket = ticketLink(site, "t", person.checkin_token);
    const cid = `door-qr-${i}`;
    const png = await qrPng(personTicket);
    const src = png
      ? `cid:${cid}`
      : `https://api.qrserver.com/v1/create-qr-code/?size=360x360&data=${encodeURIComponent(personTicket)}`;
    if (png) {
      attachments.push({
        filename: `door-qr-${i + 1}.png`,
        content: png,
        contentType: "image/png",
        contentId: cid,
      });
    }
    blocks.push(`<p style="margin:16px 0;"><strong>${escapeHtml(person.attendee_name)}</strong><br />
      <img src="${src}" alt="Door QR for ${escapeHtml(person.attendee_name)}" width="180" height="180" style="display:block;margin:8px 0;background:#ffffff;" /><br />
      <a href="${escapeHtml(personTicket)}">Open this ticket</a></p>`);
  }
  return { html: blocks.join(""), attachments };
}

const authCopy: Record<string, { subject: string; intro: string; cta: string }> = {
  signup: {
    subject: "Confirm your Team Bulldogs account",
    intro: "Thanks for joining Team Bulldogs. Confirm your email so you can sign in, track bookings, and manage the newsletter.",
    cta: "Confirm my email",
  },
  recovery: {
    subject: "Reset your Team Bulldogs password",
    intro: "We got a request to reset your password. If that was you, use the button below. If it wasn’t, you can ignore this.",
    cta: "Choose a new password",
  },
  magiclink: {
    subject: "Sign in to Team Bulldogs",
    intro: "Use this link to sign in. It expires soon.",
    cta: "Sign in",
  },
  invite: {
    subject: "You’re invited to Team Bulldogs",
    intro: "A club admin invited you to create an account.",
    cta: "Accept invite",
  },
  email_change: {
    subject: "Confirm your new Team Bulldogs email",
    intro: "Confirm this address to finish changing the email on your account.",
    cta: "Confirm new email",
  },
};

export async function sendAuthEmail(to: string, actionType: string, actionLink: string) {
  const copy = authCopy[actionType] ?? {
    subject: "Team Bulldogs account",
    intro: "Use this link to continue with your Team Bulldogs account.",
    cta: "Continue",
  };
  await sendHtml({
    to,
    subject: copy.subject,
    idempotencyKey: `auth/${actionType}/${to}/${actionLink.slice(-24)}`,
    html: wrap(`
      <p>Hi,</p>
      <p>${copy.intro}</p>
      <p><a href="${escapeHtml(actionLink)}" style="display:inline-block;background:#e4572e;color:#fff;text-decoration:none;padding:12px 18px;border-radius:4px;">${escapeHtml(copy.cta)}</a></p>
      <p style="color:#5b6472;font-size:13px;">If the button doesn’t work, copy this into your browser:<br />${escapeHtml(actionLink)}</p>
      <p>Team Bulldogs</p>`),
  });
}

export async function recordNewsletter(email: string, userId: string | null, source: string, optedIn: boolean) {
  const address = email.toLowerCase();
  if (optedIn) {
    await db.from("newsletter_subscribers").upsert({
      email: address,
      user_id: userId,
      source,
      consented_at: new Date().toISOString(),
      unsubscribed_at: null,
    });
    if (userId) await db.from("profiles").update({ newsletter_opt_in: true }).eq("id", userId);
    return;
  }
  if (userId) await db.from("profiles").update({ newsletter_opt_in: false }).eq("id", userId);
}

export async function sendRegistrationEmails(bookingId: string) {
  const { data: booking, error } = await db
    .from("bookings")
    .select("*, event:events(title, starts_at, location, what_to_bring), attendees:registrations(*)")
    .eq("id", bookingId)
    .single();
  if (error) throw error;

  const event = booking.event as {
    title: string;
    starts_at: string;
    location: string | null;
    what_to_bring: string | null;
  };
  const attendees = booking.attendees as {
    id: string;
    attendee_name: string;
    attendee_date_of_birth: string | null;
    emergency_contact_name: string | null;
    emergency_contact_phone: string | null;
    medical_notes: string | null;
    notes: string | null;
    checkin_token: string;
  }[];

  const site = getSiteUrl();
  const ticketUrl = ticketLink(site, "c", booking.cancel_token);
  const cancelUrl = `${site}/cancel.html?c=${encodeURIComponent(booking.cancel_token)}#c=${encodeURIComponent(booking.cancel_token)}`;
  const icsUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/public-booking?action=ics&c=${booking.cancel_token}`;
  const attendeesHtml = attendees
    .map((person) => `<li>${escapeHtml(person.attendee_name)}</li>`)
    .join("");
  const clubQr = attendees
    .filter((person) => person.checkin_token)
    .map((person) => {
      const personTicket = ticketLink(site, "t", person.checkin_token);
      const qr = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(personTicket)}`;
      return `<p><strong>${escapeHtml(person.attendee_name)}</strong><br /><img src="${qr}" alt="Door QR for ${escapeHtml(person.attendee_name)}" width="180" height="180" /></p>`;
    })
    .join("");

  const shared = {
    EVENT_TITLE: plain(event.title),
    EVENT_WHEN: formatDate(event.starts_at),
    ATTENDEE_NAME: plain(attendees.map((person) => person.attendee_name).join(", ")),
    BOOKER_NAME: plain(booking.full_name),
    AMOUNT_PAID: booking.amount_pence > 0 ? formatMoney(booking.amount_pence, booking.currency) : "Free",
    BOOKING_REF: reference(booking.id),
    TICKET_URL: ticketUrl,
    CANCEL_URL: cancelUrl,
    ICS_URL: icsUrl,
    QR_HTML: clubQr,
    WHAT_TO_BRING: plain(event.what_to_bring),
    EVENT_LOCATION: plain(event.location),
    ATTENDEES_HTML: `<ul>${attendeesHtml}</ul>`,
  };

  await sendTemplate({
    template: "booking-confirmation",
    to: booking.email,
    idempotencyKey: `booking-confirmation/${booking.id}/template`,
    variables: shared,
  });

  const clubNotes = attendees
    .map((person) => {
      const bits = [
        person.attendee_name,
        person.attendee_date_of_birth && `DOB ${formatDateOnly(person.attendee_date_of_birth)}`,
        [person.emergency_contact_name, person.emergency_contact_phone].filter(Boolean).join(" "),
        person.medical_notes && `Medical: ${person.medical_notes}`,
        person.notes,
      ].filter(Boolean);
      return bits.join(" — ");
    })
    .join("\n");

  await sendTemplate({
    template: "booking-club-alert",
    to: clubEmail,
    replyTo: booking.email,
    idempotencyKey: `booking-club-alert/${booking.id}`,
    variables: {
      ...shared,
      ATTENDEE_DOB: formatDateOnly(attendees[0]?.attendee_date_of_birth ?? null),
      BOOKER_EMAIL: booking.email,
      BOOKER_PHONE: plain(booking.phone),
      EMERGENCY_CONTACT: plain(
        [attendees[0]?.emergency_contact_name, attendees[0]?.emergency_contact_phone].filter(Boolean).join(" · "),
      ),
      NOTES: plain(clubNotes),
      NEWSLETTER: booking.newsletter_opt_in ? "Yes" : "No",
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

export async function sendBookingCancelled(bookingId: string, refunded: boolean) {
  const { data: booking, error } = await db
    .from("bookings")
    .select("email, full_name, amount_pence, currency, event:events(title, starts_at)")
    .eq("id", bookingId)
    .single();
  if (error) throw error;
  const event = booking.event as { title: string; starts_at: string };
  await sendHtml({
    to: booking.email,
    subject: `Booking cancelled — ${event.title}`,
    idempotencyKey: `booking-cancelled/${bookingId}`,
    html: wrap(
      `<p>Hi ${escapeHtml(booking.full_name)},</p>
      <p>Your booking for <strong>${escapeHtml(event.title)}</strong> (${escapeHtml(formatDate(event.starts_at))}) has been cancelled. The place is back on sale.</p>
      <p>${refunded ? `A refund of ${escapeHtml(formatMoney(booking.amount_pence, booking.currency))} is on its way.` : "No payment was taken."}</p>
      <p>Team Bulldogs</p>`,
    ),
  });
}

export async function sendClubCancelledEvent(to: string, name: string, title: string, when: string, amount: string) {
  await sendHtml({
    to,
    subject: `Event cancelled — ${title}`,
    idempotencyKey: `club-cancel/${to}/${title}/${when}`,
    html: wrap(
      `<p>Hi ${escapeHtml(name)},</p>
      <p>We’re sorry — <strong>${escapeHtml(title)}</strong> on ${escapeHtml(when)} has been cancelled by the club.</p>
      <p>A refund of ${escapeHtml(amount)} is on its way.</p>
      <p>Team Bulldogs</p>`,
    ),
  });
}

export async function sendUnpaidReminder(to: string, name: string, what: string, payUrl: string, until: string, from?: string) {
  await sendHtml({
    to,
    from,
    subject: `Finish your Bulldogs checkout`,
    idempotencyKey: `unpaid/${to}/${payUrl}`,
    html: wrap(
      `<p>Hi ${escapeHtml(name)},</p>
      <p>You started checkout for <strong>${escapeHtml(what)}</strong> but haven’t paid yet. It’s held until ${escapeHtml(until)}.</p>
      <p><a href="${escapeHtml(payUrl)}">Complete payment</a></p>
      <p>If you don’t want it, you can ignore this and the hold will drop off.</p>
      <p>Team Bulldogs</p>`,
    ),
  });
}

export async function sendCartReminder(to: string, name: string) {
  const shop = `${getSiteUrl()}/shop.html`;
  await sendHtml({
    to,
    from: fromOrders,
    subject: "You left something in your Bulldogs bag",
    idempotencyKey: `cart/${to}`,
    html: wrap(
      `<p>Hi ${escapeHtml(name || "there")},</p>
      <p>Your bag is still waiting. <a href="${shop}">Back to the shop</a> if you’d like to finish the order.</p>
      <p>Team Bulldogs</p>`,
    ),
  });
}

export async function sendDayBeforeReminder(bookingId: string) {
  const { data: booking, error } = await db
    .from("bookings")
    .select("email, full_name, cancel_token, event:events(title, starts_at, location, what_to_bring), attendees:registrations(attendee_name, checkin_token, status)")
    .eq("id", bookingId)
    .single();
  if (error) throw error;
  const event = booking.event as {
    title: string;
    starts_at: string;
    location: string | null;
    what_to_bring: string | null;
  };
  const site = getSiteUrl();
  const ticketUrl = ticketLink(site, "c", booking.cancel_token);
  const people = ((booking.attendees ?? []) as { attendee_name: string; checkin_token: string; status: string }[])
    .filter((person) => person.checkin_token && person.status === "paid");
  const codes = await doorCodes(site, people);
  await sendHtml({
    to: booking.email,
    subject: `Tomorrow: ${event.title}`,
    idempotencyKey: `day-before/${bookingId}`,
    attachments: codes.attachments,
    html: wrap(
      `<p>Hi ${escapeHtml(booking.full_name)},</p>
      <p>See you tomorrow for <strong>${escapeHtml(event.title)}</strong> — ${escapeHtml(formatDate(event.starts_at))}.</p>
      ${event.location ? `<p>${escapeHtml(event.location)}</p>` : ""}
      ${event.what_to_bring ? `<p>Bring: ${escapeHtml(event.what_to_bring)}</p>` : ""}
      <p>Show one QR per attendee at the door.</p>
      ${codes.html}
      <p><a href="${escapeHtml(ticketUrl)}">All tickets</a></p>
      <p>Team Bulldogs</p>`,
    ),
  });
}
