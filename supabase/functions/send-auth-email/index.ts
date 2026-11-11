import { Webhook } from "https://esm.sh/standardwebhooks@1.0.0";
import { requireEnv } from "../_shared/http.ts";
import { sendAuthEmail } from "../_shared/notifications.ts";

function hookSecret() {
  const raw = Deno.env.get("SEND_EMAIL_HOOK_SECRET") ?? "";
  return raw.replace(/^v1,whsec_/, "");
}

function verifyUrl(tokenHash: string, actionType: string, redirectTo: string) {
  const base = requireEnv("SUPABASE_URL").replace(/\/+$/, "");
  const params = new URLSearchParams({
    token: tokenHash,
    type: actionType,
    redirect_to: redirectTo,
  });
  return `${base}/auth/v1/verify?${params.toString()}`;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const payload = await req.text();
  const secret = hookSecret();
  let email = "";
  let actionType = "signup";
  let tokenHash = "";
  let redirectTo = "";

  try {
    if (secret) {
      const verified = new Webhook(secret).verify(payload, Object.fromEntries(req.headers)) as {
        user: { email?: string };
        email_data: {
          token_hash: string;
          email_action_type: string;
          redirect_to: string;
        };
      };
      email = verified.user.email ?? "";
      actionType = verified.email_data.email_action_type;
      tokenHash = verified.email_data.token_hash;
      redirectTo = verified.email_data.redirect_to;
    } else {
      const parsed = JSON.parse(payload) as {
        user?: { email?: string };
        email_data?: { token_hash?: string; email_action_type?: string; redirect_to?: string };
      };
      email = parsed.user?.email ?? "";
      actionType = parsed.email_data?.email_action_type ?? "signup";
      tokenHash = parsed.email_data?.token_hash ?? "";
      redirectTo = parsed.email_data?.redirect_to ?? "";
    }
  } catch (err) {
    console.error("Auth email hook verify failed", err);
    return Response.json({ error: { message: "Invalid hook payload" } }, { status: 401 });
  }

  if (!email || !tokenHash) {
    return Response.json({ error: { message: "Missing email data" } }, { status: 400 });
  }

  try {
    await sendAuthEmail(email, actionType, verifyUrl(tokenHash, actionType, redirectTo));
  } catch (err) {
    console.error("Auth email send failed", err);
    return Response.json({ error: { message: "Couldn't send email" } }, { status: 500 });
  }

  return Response.json({});
});
