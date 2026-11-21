import { db } from "./clients.ts";
import { bearer } from "./http.ts";

/** viaGoogle: this session was signed in with Google (not a password or email link). */
export type AppUser = { id: string; email: string; viaGoogle: boolean };

/** Sign-in methods recorded in a session token that Supabase has already verified. */
function sessionMethods(token: string): string[] {
  try {
    const part = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const claims = JSON.parse(atob(part.padEnd(part.length + ((4 - (part.length % 4)) % 4), "=")));
    return Array.isArray(claims.amr) ? claims.amr.map((entry: { method?: string }) => String(entry?.method ?? "")) : [];
  } catch {
    return [];
  }
}

export async function getUser(req: Request): Promise<AppUser | null> {
  const token = bearer(req);
  if (!token || token.startsWith("sb_")) return null;
  const { data, error } = await db.auth.getUser(token);
  const email = data.user?.email?.toLowerCase();
  if (error || !data.user || !email) return null;
  const hasGoogle = (data.user.identities ?? []).some((identity) => identity.provider === "google");
  const oauthSession = sessionMethods(token).some((method) => method === "oauth" || method === "id_token");
  return { id: data.user.id, email, viaGoogle: hasGoogle && oauthSession };
}

export async function requireUser(req: Request): Promise<AppUser> {
  const user = await getUser(req);
  if (!user) {
    const err = new Error("Please sign in");
    (err as Error & { status: number }).status = 401;
    throw err;
  }
  return user;
}

async function adminRow(user: AppUser) {
  const { data } = await db.from("admins").select("email, user_id").eq("email", user.email).maybeSingle();
  return data;
}

async function onAdminList(user: AppUser): Promise<boolean> {
  return Boolean(await adminRow(user));
}

/** Admin rights need the email on the admin list AND a Google sign-in (Google handles 2-step verification). */
export async function isAdmin(user: AppUser): Promise<boolean> {
  if (!user.viaGoogle) return false;
  const row = await adminRow(user);
  if (!row) return false;
  if (row.user_id !== user.id) {
    await db.from("admins").update({ user_id: user.id }).eq("email", user.email);
  }
  return true;
}

export async function requireClub(req: Request): Promise<AppUser> {
  const user = await requireUser(req);
  if (!(await isAdmin(user))) {
    const listed = await onAdminList(user);
    const err = new Error(listed ? "Club admins must sign in with Google. Sign out, then use Continue with Google." : "Club access only");
    (err as Error & { status: number }).status = 403;
    throw err;
  }
  return user;
}

export const reference = (id: string) => id.slice(0, 8).toUpperCase();

export const cancelHours = () => Number(Deno.env.get("BOOKING_CANCEL_HOURS") ?? "24");

export function canSelfCancel(startsAt: string): boolean {
  return Date.now() <= new Date(startsAt).getTime() - cancelHours() * 60 * 60 * 1000;
}
