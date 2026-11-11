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

  const fn = async (name, body, { method = "POST", query = "" } = {}) => {
    const { supabaseUrl } = cfg();
    const res = await fetch(`${supabaseUrl}/functions/v1/${name}${query}`, {
      method,
      headers: headers(),
      body: method === "GET" ? undefined : JSON.stringify(body ?? {}),
    });
    const payload = await res.json().catch(() => ({}));
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
