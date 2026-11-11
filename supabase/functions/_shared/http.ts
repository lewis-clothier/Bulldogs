export function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}

export function getSiteUrl(): string {
  return requireEnv("SITE_URL").replace(/\/+$/, "");
}

/** Prefer the page the visitor is on (local :3000 or production) when it is an allowed origin. */
export function checkoutSiteUrl(req: Request): string {
  const origin = (req.headers.get("Origin") ?? "").replace(/\/+$/, "");
  const allowed = [
    ...(Deno.env.get("ALLOWED_ORIGINS") ?? getSiteUrl()).split(",").map((value) => value.trim().replace(/\/+$/, "")),
    "http://localhost:3000",
    "http://127.0.0.1:3000",
  ].filter(Boolean);
  if (origin && allowed.includes(origin)) return origin;
  return getSiteUrl();
}

function corsHeaders(req: Request, methods = "POST, OPTIONS"): Record<string, string> {
  const allowedOrigins = [
    ...(Deno.env.get("ALLOWED_ORIGINS") ?? getSiteUrl())
      .split(",")
      .map((origin) => origin.trim().replace(/\/+$/, "")),
    "http://localhost:3000",
    "http://127.0.0.1:3000",
  ].filter(Boolean);
  const origin = req.headers.get("Origin") ?? "";
  return {
    "Access-Control-Allow-Origin": allowedOrigins.includes(origin) ? origin : allowedOrigins[0],
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
    "Access-Control-Allow-Methods": methods,
    Vary: "Origin",
  };
}

export function json(req: Request, body: unknown, status = 200, methods = "POST, OPTIONS"): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req, methods), "Content-Type": "application/json" },
  });
}

/** Handles CORS preflight and rejects anything but POST. Returns null when the request should proceed. */
export function preflight(req: Request, methods = "POST, OPTIONS"): Response | null {
  const allowed = methods.split(",").map((m) => m.trim());
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(req, methods) });
  if (!allowed.includes(req.method)) return json(req, { error: "Method not allowed" }, 405, methods);
  return null;
}

export function bearer(req: Request): string | null {
  const raw = req.headers.get("Authorization") ?? "";
  const match = raw.match(/^Bearer\s+(\S+)/i);
  return match?.[1] ?? null;
}

export async function readJson(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await req.json();
    return body && typeof body === "object" && !Array.isArray(body) ? body : null;
  } catch {
    return null;
  }
}

export class ValidationError extends Error {}

export function text(value: unknown, field: string, max: number, required = false): string | null {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed) {
    if (required) throw new ValidationError(`${field} is required`);
    return null;
  }
  if (trimmed.length > max) throw new ValidationError(`${field} is too long`);
  return trimmed;
}

export function email(value: unknown, field = "Email"): string {
  const address = text(value, field, 254, true)!;
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(address)) throw new ValidationError(`${field} is not valid`);
  return address.toLowerCase();
}
