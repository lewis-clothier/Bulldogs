(() => {
  const injectFooter = () => {
    const bottom = document.querySelector(".footer__bottom");
    if (!bottom || bottom.querySelector("[data-legal-links]")) return;
    const span = document.createElement("span");
    span.dataset.legalLinks = "";
    span.innerHTML = `<a href="terms.html">Terms</a> · <a href="privacy.html">Privacy</a> · <a href="booking-policy.html">Bookings</a> · <a href="shop-policy.html">Shop</a>`;
    bottom.appendChild(span);
  };

  injectFooter();

  const { supabaseUrl, supabaseKey } = window.BULLDOGS || {};
  const startAuth = (attempt = 0) => {
    if (!supabaseUrl || !supabaseKey) return;
    if (!window.supabase) {
      if (attempt < 40) setTimeout(() => startAuth(attempt + 1), 50);
      return;
    }
    const client = window.supabase.createClient(supabaseUrl, supabaseKey);
    window.BULLDOGS_SB = client;
    const setSession = (session) => {
      window.BULLDOGS_SESSION = session;
    };
    client.auth.onAuthStateChange((_event, session) => setSession(session));
    client.auth.getSession().then(({ data }) => setSession(data.session));
  };
  startAuth();
})();
