import { db } from "../_shared/clients.ts";
import { checkoutSiteUrl, email, getSiteUrl, json, preflight, readJson, text, ValidationError } from "../_shared/http.ts";
import { sendAuthEmail } from "../_shared/notifications.ts";

Deno.serve(async (req) => {
  const early = preflight(req);
  if (early) return early;

  const body = await readJson(req);
  if (!body) return json(req, { error: "Invalid request" }, 400);

  try {
    const action = text(body.action, "Action", 40, true);
    const redirectTo = `${checkoutSiteUrl(req)}/index.html`;
    const fallbackRedirect = `${getSiteUrl()}/index.html`;

    if (action === "signup") {
      const address = email(body.email);
      const password = text(body.password, "Password", 72, true)!;
      if (password.length < 6) throw new ValidationError("Password must be at least 6 characters");
      const fullName = text(body.full_name, "Name", 200);
      let data;
      let error;
      ({ data, error } = await db.auth.admin.generateLink({
        type: "signup",
        email: address,
        password,
        options: {
          data: fullName ? { full_name: fullName } : {},
          redirectTo,
        },
      }));
      if (error && redirectTo !== fallbackRedirect) {
        ({ data, error } = await db.auth.admin.generateLink({
          type: "signup",
          email: address,
          password,
          options: {
            data: fullName ? { full_name: fullName } : {},
            redirectTo: fallbackRedirect,
          },
        }));
      }
      if (error) {
        if (/already|registered|exists/i.test(error.message)) {
          return json(req, { error: "That email already has an account. Sign in instead." }, 409);
        }
        console.error("signup generateLink failed", error);
        return json(req, { error: "Couldn't create that account. Try again." }, 500);
      }
      const link = data.properties?.action_link;
      if (!link) return json(req, { error: "Couldn't create that account. Try again." }, 500);
      await sendAuthEmail(address, "signup", link);
      return json(req, { ok: true });
    }

    if (action === "reset") {
      const address = email(body.email);
      let data;
      let error;
      ({ data, error } = await db.auth.admin.generateLink({
        type: "recovery",
        email: address,
        options: { redirectTo },
      }));
      if (error && redirectTo !== fallbackRedirect) {
        ({ data, error } = await db.auth.admin.generateLink({
          type: "recovery",
          email: address,
          options: { redirectTo: fallbackRedirect },
        }));
      }
      if (error) {
        console.error("reset generateLink failed", error);
        return json(req, { ok: true });
      }
      const link = data.properties?.action_link;
      if (link) await sendAuthEmail(address, "recovery", link);
      return json(req, { ok: true });
    }

    return json(req, { error: "Unknown action" }, 400);
  } catch (err) {
    if (err instanceof ValidationError) return json(req, { error: err.message }, 400);
    console.error(err);
    return json(req, { error: "Request failed" }, 500);
  }
});
