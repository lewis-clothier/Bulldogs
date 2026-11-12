import { Resend } from "npm:resend@6";

const apiKey = Deno.env.get("RESEND_API_KEY");
const resend = apiKey ? new Resend(apiKey) : null;

export const clubEmail = Deno.env.get("CLUB_EMAIL") ?? "bulldogs.limited@gmail.com";
export const fromBookings = Deno.env.get("RESEND_FROM") ?? "Team Bulldogs <bookings@mail.teambulldogs.co.uk>";
export const fromOrders = Deno.env.get("RESEND_FROM_ORDERS") ?? "Team Bulldogs <orders@mail.teambulldogs.co.uk>";

/** Published template aliases in Resend. Copy, senders and subjects are edited there, not here. */
export type TemplateAlias = "booking-confirmation" | "booking-club-alert" | "order-confirmation" | "order-club-alert";

const fromAddress = fromBookings;

const MAX_ATTEMPTS = 3;

export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Resend inserts template variables as raw HTML and also uses them in subjects, so text that
 * came from a visitor has its angle brackets removed rather than being entity-escaped.
 */
export function plain(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const cleaned = String(value).replace(/[<>]/g, "").trim();
  return cleaned || null;
}

export function formatMoney(pence: number, currency: string): string {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: currency.toUpperCase() }).format(pence / 100);
}

export function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: "Europe/London",
  }).format(new Date(iso));
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Sends a published Resend template. Empty variables are left out so the template's fallback is used.
 * Never throws: a failed email must not undo a payment that has already been recorded.
 */
export async function sendTemplate(message: {
  template: TemplateAlias;
  to: string;
  variables: Record<string, string | number | null | undefined>;
  idempotencyKey: string;
  replyTo?: string;
}) {
  if (!resend) {
    console.warn(`RESEND_API_KEY not set; skipped ${message.template} to ${message.to}`);
    return;
  }

  const variables: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(message.variables)) {
    if (value !== null && value !== undefined && value !== "") variables[key] = value;
  }

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const { data, error } = await resend.emails.send(
        {
          to: message.to,
          ...(message.replyTo && { replyTo: message.replyTo }),
          template: { id: message.template, variables },
        },
        { idempotencyKey: message.idempotencyKey },
      );

      if (!error) {
        console.log(`Sent ${message.template} to ${message.to} (${data?.id})`);
        return;
      }

      const status = (error as { statusCode?: number | null }).statusCode ?? 0;
      const retryable = status === 429 || status >= 500;
      if (!retryable || attempt === MAX_ATTEMPTS) {
        console.error(`Failed to send ${message.template} to ${message.to}`, error);
        return;
      }
    } catch (err) {
      if (attempt === MAX_ATTEMPTS) {
        console.error(`Failed to send ${message.template} to ${message.to}`, err);
        return;
      }
    }
    await sleep(1000 * 2 ** (attempt - 1));
  }
}

export type MailAttachment = {
  filename: string;
  content: string;
  contentType?: string;
  contentId?: string;
};

export async function sendHtml(message: {
  to: string;
  subject: string;
  html: string;
  idempotencyKey: string;
  replyTo?: string;
  from?: string;
  attachments?: MailAttachment[];
}) {
  if (!resend) {
    console.warn(`RESEND_API_KEY not set; skipped html mail to ${message.to}`);
    return;
  }
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const { error } = await resend.emails.send(
        {
          from: message.from ?? fromAddress,
          to: message.to,
          subject: message.subject,
          html: message.html,
          ...(message.replyTo && { replyTo: message.replyTo }),
          ...(message.attachments?.length ? { attachments: message.attachments } : {}),
        },
        { idempotencyKey: message.idempotencyKey },
      );
      if (!error) return;
      const status = (error as { statusCode?: number | null }).statusCode ?? 0;
      if ((status !== 429 && status < 500) || attempt === MAX_ATTEMPTS) {
        console.error(`Failed to send html mail to ${message.to}`, error);
        return;
      }
    } catch (err) {
      if (attempt === MAX_ATTEMPTS) {
        console.error(`Failed to send html mail to ${message.to}`, err);
        return;
      }
    }
    await sleep(1000 * 2 ** (attempt - 1));
  }
}
