import { db } from "../_shared/clients.ts";
import { json } from "../_shared/http.ts";
import { sendDayBeforeReminder } from "../_shared/notifications.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

function authorized(req: Request) {
  const secret = Deno.env.get("CRON_SECRET");
  if (!secret) return false;
  return req.headers.get("x-cron-secret") === secret || req.headers.get("Authorization") === `Bearer ${secret}`;
}

// Called every few minutes by pg_cron. Emails each confirmed booking once, as soon as its
// event is 24 hours away. Bookings made inside that 24 hours are skipped: their confirmation
// email already has the same details.
Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  if (!authorized(req)) return json(req, { error: "Unauthorized" }, 401);

  const now = Date.now();
  const { data: due, error } = await db
    .from("bookings")
    .select("id, created_at, event:events!inner(starts_at)")
    .eq("status", "paid")
    .is("day_before_email_sent_at", null)
    .gt("event.starts_at", new Date(now).toISOString())
    .lte("event.starts_at", new Date(now + DAY_MS).toISOString());
  if (error) {
    console.error("send-reminders query failed", error);
    return json(req, { error: "Query failed" }, 500);
  }

  let sent = 0;
  let skipped = 0;
  let failed = 0;
  for (const booking of due ?? []) {
    const startsAt = new Date((booking.event as unknown as { starts_at: string }).starts_at).getTime();
    if (new Date(booking.created_at).getTime() > startsAt - DAY_MS) {
      skipped++;
      continue;
    }
    try {
      await sendDayBeforeReminder(booking.id);
      await db.from("bookings").update({ day_before_email_sent_at: new Date().toISOString() }).eq("id", booking.id);
      sent++;
    } catch (err) {
      console.error("Event reminder failed", booking.id, err);
      failed++;
    }
  }

  return json(req, { ok: true, sent, skipped, failed });
});
