export function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}

export function getSiteUrl(): string {
  return requireEnv("SITE_URL").replace(/\/+$/, "");
}

function corsHeaders(req: Request): Record<string, string> {
  const allowedOrigins = (Deno.env.get("ALLOWED_ORIGINS") ?? `${getSiteUrl()},http://localhost:3000`)
    .split(",")
    .map((origin) => origin.trim().replace(/\/+$/, ""))
    .filter(Boolean);
  const origin = req.headers.get("Origin") ?? "";
  return {
    "Access-Control-Allow-Origin": allowedOrigins.includes(origin) ? origin : allowedOrigins[0],
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
}

export function json(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), "Content-Type": "application/json" },
  });
}

/** Handles CORS preflight and rejects anything but POST. Returns null when the request should proceed. */
export function preflight(req: Request): Response | null {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(req) });
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);
  return null;
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
