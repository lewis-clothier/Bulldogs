(() => {
  const cfg = () => window.BULLDOGS || {};

  const headers = (extra = {}) => {
    const { supabaseKey } = cfg();
    const session = window.BULLDOGS_SESSION;
    const token = session?.access_token || supabaseKey;
    return {
      apikey: supabaseKey,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...extra,
    };
  };

  // A signed-in request the server rejects as "not signed in" means the account was deleted or the
  // session revoked. Clear it in this browser so the page shows the signed-out state instead of
  // retrying forever.
  // First try refreshing (a token can simply have expired, e.g. after sleep); only if that fails
  // is the session really dead.
  let recovering = null;
  const recoverSession = () => {
    const sb = window.BULLDOGS_SB;
    if (!sb) return Promise.resolve(false);
    if (!recovering) {
      recovering = sb.auth
        .refreshSession()
        .then(async ({ data, error }) => {
          if (!error && data?.session) {
            window.BULLDOGS_SESSION = data.session;
            return true;
          }
          await sb.auth.signOut({ scope: "local" }).catch(() => {});
          return false;
        })
        .catch(async () => {
          await sb.auth.signOut({ scope: "local" }).catch(() => {});
          return false;
        })
        .finally(() => {
          recovering = null;
        });
    }
    return recovering;
  };

  const fn = async (name, body, { method = "POST", query = "" } = {}, retried = false) => {
    const { supabaseUrl } = cfg();
    const signedIn = Boolean(window.BULLDOGS_SESSION?.access_token);
    const res = await fetch(`${supabaseUrl}/functions/v1/${name}${query}`, {
      method,
      headers: headers(),
      body: method === "GET" ? undefined : JSON.stringify(body ?? {}),
    });
    const payload = await res.json().catch(() => ({}));
    if (res.status === 401 && signedIn && !retried) {
      if (await recoverSession()) return fn(name, body, { method, query }, true);
      throw new Error("You've been signed out. Please sign in again.");
    }
    if (!res.ok) throw new Error(payload.error || "Request failed");
    return payload;
  };

  const rpc = async (name, body = {}) => {
    const { supabaseUrl } = cfg();
    const res = await fetch(`${supabaseUrl}/rest/v1/rpc/${name}`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error("Couldn't load data");
    return res.json();
  };

  window.BULLDOGS_API = { headers, fn, rpc };
})();
