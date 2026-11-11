import { db } from "./clients.ts";
import { bearer } from "./http.ts";

export type AppUser = { id: string; email: string };

export async function getUser(req: Request): Promise<AppUser | null> {
  const token = bearer(req);
  if (!token || token.startsWith("sb_")) return null;
  const { data, error } = await db.auth.getUser(token);
  const email = data.user?.email?.toLowerCase();
  if (error || !data.user || !email) return null;
  return { id: data.user.id, email };
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

export async function isAdmin(user: AppUser): Promise<boolean> {
  const { data } = await db.from("admins").select("email, user_id").eq("email", user.email).maybeSingle();
  if (!data) return false;
  if (data.user_id !== user.id) {
    await db.from("admins").update({ user_id: user.id }).eq("email", user.email);
  }
  return true;
}

export async function requireClub(req: Request): Promise<AppUser> {
  const user = await requireUser(req);
  if (!(await isAdmin(user))) {
    const err = new Error("Club access only");
    (err as Error & { status: number }).status = 403;
    throw err;
  }
  return user;
}

export async function maybeCreateAccount(
  email: string,
  password: string | null,
  fullName: string | null,
): Promise<string | null> {
  if (!password) return null;
  const { data, error } = await db.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: fullName ? { full_name: fullName } : {},
  });
  if (error) {
    if (/already/i.test(error.message)) {
      const { data: existing } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
      const match = existing.users.find((user) => user.email?.toLowerCase() === email);
      return match?.id ?? null;
    }
    console.error("createUser failed", error);
    return null;
  }
  return data.user?.id ?? null;
}

export const reference = (id: string) => id.slice(0, 8).toUpperCase();

export const cancelHours = () => Number(Deno.env.get("BOOKING_CANCEL_HOURS") ?? "24");

export function canSelfCancel(startsAt: string): boolean {
  return Date.now() <= new Date(startsAt).getTime() - cancelHours() * 60 * 60 * 1000;
}
