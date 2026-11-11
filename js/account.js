(() => {
  const gate = document.querySelector("[data-account-gate]");
  const app = document.querySelector("[data-account-app]");
  const auth = window.BULLDOGS_AUTH;
  const api = window.BULLDOGS_API;
  if (!auth || !app) return;

  const emailLine = document.querySelector("[data-auth-email]");
  const setGateStatus = (msg, isError = false) => {
    const status = document.querySelector("[data-account-gate] .form-status, [data-profile-form] .form-status");
    if (!status) return;
    status.textContent = msg;
    status.classList.toggle("is-error", isError);
  };

  const when = (iso) =>
    new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/London" }).format(new Date(iso));

  const showUser = async (session) => {
    if (gate) gate.hidden = Boolean(session);
    app.hidden = !session;
    if (emailLine) emailLine.textContent = session?.user?.email || "";
    if (!session) {
      if (auth.nextPath()) auth.open({ mode: "signin" });
      return;
    }
    if (auth.nextPath()) {
      auth.goNext();
      return;
    }
    if (!api) return;
    try {
      const profile = await api.fn("me-api", { action: "profile" });
      const pf = document.querySelector("[data-profile-form]");
      if (pf) {
        pf.newsletter_opt_in.checked = profile.newsletter;
        pf.full_name.value = profile.profile?.full_name || "";
      }
      const clubLink = document.querySelector("[data-club-link]");
      if (clubLink) clubLink.hidden = !profile.is_admin;
      const bookings = await api.fn("me-api", { action: "bookings" });
      const box = document.querySelector("[data-my-bookings]");
      const rows = (bookings.bookings || []).filter((b) => b.status === "paid" || b.status === "pending");
      if (!box) return;
      if (!rows.length) {
        box.textContent = "No bookings yet.";
        return;
      }
      box.innerHTML = rows
        .map((b) => {
          const event = b.event || {};
          const eligible =
            b.status === "paid" && event.starts_at && Date.now() <= new Date(event.starts_at).getTime() - 24 * 60 * 60 * 1000;
          const cancel = eligible ? `<button class="btn btn--ghost" type="button" data-cancel-booking="${b.id}">Cancel</button>` : "";
          const ticket = b.cancel_token ? `<a class="btn btn--accent" href="ticket.html?c=${b.cancel_token}">Tickets</a>` : "";
          const ics = b.cancel_token
            ? `<a class="btn btn--ghost" href="${window.BULLDOGS.supabaseUrl}/functions/v1/public-booking?action=ics&c=${b.cancel_token}">Calendar</a>`
            : "";
          return `<article class="account-card"><h3>${event.title || "Event"}</h3><p class="muted">${event.starts_at ? when(event.starts_at) : ""} · ${b.status}</p><p>${(b.attendees || []).map((a) => a.attendee_name).join(", ")}</p><p>${ticket} ${ics} ${cancel}</p></article>`;
        })
        .join("");
    } catch (err) {
      setGateStatus(err.message, true);
    }
  };

  auth.whenReady().then((sb) => {
    sb.auth.onAuthStateChange((_event, session) => showUser(session));
    sb.auth.getSession().then(({ data }) => showUser(data.session));
  });

  document.querySelector("[data-sign-out]")?.addEventListener("click", async () => {
    const sb = await auth.whenReady();
    await sb.auth.signOut();
  });

  document.querySelector("[data-profile-form]")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const pf = e.currentTarget;
    const st = pf.querySelector(".form-status");
    try {
      await api.fn("me-api", {
        action: "save_profile",
        full_name: pf.full_name.value,
        newsletter_opt_in: pf.newsletter_opt_in.checked,
      });
      st.textContent = "Saved.";
      st.classList.remove("is-error");
    } catch (err) {
      st.textContent = err.message;
      st.classList.add("is-error");
    }
  });

  document.querySelector("[data-my-bookings]")?.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-cancel-booking]");
    if (!btn) return;
    if (!confirm("Cancel this booking and refund if you're outside 24 hours?")) return;
    try {
      await api.fn("me-api", { action: "cancel_booking", booking_id: btn.dataset.cancelBooking });
      const sb = await auth.whenReady();
      showUser((await sb.auth.getSession()).data.session);
    } catch (err) {
      alert(err.message);
    }
  });
})();
