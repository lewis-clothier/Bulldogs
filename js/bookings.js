(() => {
  const root = document.querySelector("[data-bookings]");
  const auth = window.BULLDOGS_AUTH;
  const api = window.BULLDOGS_API;
  if (!root || !auth || !api) return;

  const escapeHtml = (value) =>
    String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  const when = (iso) =>
    new Intl.DateTimeFormat("en-GB", {
      dateStyle: "full",
      timeStyle: "short",
      timeZone: "Europe/London",
    }).format(new Date(iso));

  const labels = {
    paid: "Paid",
    pending: "Awaiting payment",
    refunded: "Refunded",
    cancelled: "Cancelled",
    expired: "Expired",
  };

  const ticketUrl = (token) => {
    const code = encodeURIComponent(token);
    return `${location.origin}/ticket.html?t=${code}#t=${code}`;
  };

  const canCancel = (booking) => {
    const starts = booking.event?.starts_at;
    return booking.status === "paid" && starts && Date.now() <= new Date(starts).getTime() - 24 * 60 * 60 * 1000;
  };

  let bookings = [];
  let openId = "";
  let seq = 0;

  const signedOut = () => {
    root.innerHTML = `<p class="muted">Sign in to see the bookings on this account.</p>
      <p><button class="btn btn--accent" type="button" data-open-auth="signin">Sign in</button></p>`;
  };

  const detailFor = (booking) => {
    if (booking.status !== "paid") {
      const line =
        booking.status === "pending"
          ? "This place is held, but it isn’t paid yet, so there’s no door code."
          : `This booking is ${labels[booking.status] || booking.status}.`;
      return `<div class="booking-card__detail"><p class="muted">${line}</p></div>`;
    }
    const ics = booking.cancel_token
      ? `${window.BULLDOGS.supabaseUrl}/functions/v1/public-booking?action=ics&c=${encodeURIComponent(booking.cancel_token)}`
      : "";
    const cancel = canCancel(booking)
      ? `<button class="btn btn--ghost btn--small" type="button" data-cancel-booking="${escapeHtml(booking.id)}">Cancel booking</button>`
      : "";
    const started = booking.event?.starts_at && Date.now() > new Date(booking.event.starts_at).getTime();
    const closed = !cancel && !started ? `<p class="muted">Online cancellation closes 24 hours before the session.</p>` : "";
    return `<div class="booking-card__detail">
      <p class="muted">Show this at the door. It’s the same code as the confirmation email.</p>
      <div class="ticket-grid" data-qrs></div>
      <div class="booking-card__actions">
        ${ics ? `<a class="btn btn--ghost btn--small" href="${ics}">Add to calendar</a>` : ""}
        ${cancel}
      </div>
      ${closed}
      <p class="form-status" role="status" data-booking-status></p>
    </div>`;
  };

  const paint = () => {
    if (!bookings.length) {
      root.innerHTML = `<p class="muted">No bookings yet.</p><p><a class="btn btn--ghost" href="events.html">See events</a></p>`;
      return;
    }
    root.innerHTML = `<div class="booking-list">${bookings
      .map((booking) => {
        const event = booking.event || {};
        const open = booking.id === openId;
        const meta = [event.starts_at ? when(event.starts_at) : "", event.location || ""].filter(Boolean).join(" · ");
        const ticketLabel = booking.status === "paid" ? (open ? "Hide tickets" : "Show tickets") : open ? "Hide details" : "Show details";
        return `<article class="booking-card" data-booking="${escapeHtml(booking.id)}">
          <button class="booking-card__toggle" type="button" data-booking-toggle="${escapeHtml(booking.id)}" aria-expanded="${open ? "true" : "false"}">
            <span>
              <span class="booking-card__title">${escapeHtml(event.title || "Event")}</span>
              <span class="booking-card__when">${escapeHtml(meta)}</span>
            </span>
            <span class="booking-card__aside">
              <span class="booking-card__status" data-status="${escapeHtml(booking.status)}">${escapeHtml(labels[booking.status] || booking.status)}</span>
              <span class="booking-card__cta">${ticketLabel}</span>
            </span>
          </button>
          ${open ? detailFor(booking) : ""}
        </article>`;
      })
      .join("")}</div>`;
  };

  const drawCodes = async (article) => {
    if (!article || article.dataset.drawn) return;
    const booking = bookings.find((item) => item.id === article.getAttribute("data-booking"));
    const grid = article.querySelector("[data-qrs]");
    if (!booking || !grid) return;
    article.dataset.drawn = "1";
    const people = (booking.attendees || []).filter(
      (person) => person.checkin_token && person.status !== "cancelled" && person.status !== "refunded",
    );
    if (!people.length) {
      grid.innerHTML = `<p class="muted">No door code on this booking yet.</p>`;
      return;
    }
    for (const person of people) {
      const card = document.createElement("article");
      card.className = "ticket-card";
      card.innerHTML = `<h3>${escapeHtml(person.attendee_name || "Attendee")}</h3>`;
      grid.appendChild(card);
      if (typeof qrcode === "function") {
        const qr = qrcode(0, "M");
        qr.addData(ticketUrl(person.checkin_token));
        qr.make();
        const img = document.createElement("img");
        img.src = qr.createDataURL(6, 2);
        img.width = 220;
        img.height = 220;
        img.alt = "";
        card.appendChild(img);
      }
    }
  };

  const load = async (session) => {
    const mine = ++seq;
    window.BULLDOGS_SESSION = session || null;
    if (!session) {
      openId = "";
      bookings = [];
      signedOut();
      return;
    }
    if (!root.querySelector("[data-booking]")) root.innerHTML = `<p class="muted">Loading bookings…</p>`;
    try {
      const payload = await api.fn("me-api", { action: "bookings" });
      if (mine !== seq) return;
      bookings = payload.bookings || [];
      if (openId && !bookings.some((booking) => booking.id === openId)) openId = "";
      paint();
      if (openId) await drawCodes(root.querySelector(`[data-booking="${CSS.escape(openId)}"]`));
    } catch (err) {
      if (mine !== seq) return;
      root.innerHTML = `<p>${escapeHtml(err.message || "Couldn't load bookings.")}</p>`;
    }
  };

  root.addEventListener("click", async (event) => {
    const toggle = event.target.closest("[data-booking-toggle]");
    const cancel = event.target.closest("[data-cancel-booking]");
    if (toggle) {
      const id = toggle.getAttribute("data-booking-toggle") || "";
      openId = openId === id ? "" : id;
      paint();
      if (openId) await drawCodes(root.querySelector(`[data-booking="${CSS.escape(openId)}"]`));
    }
    if (!cancel) return;
    if (!confirm("Cancel this booking? If you're more than 24 hours out, you'll be refunded.")) return;
    const status = cancel.closest(".booking-card")?.querySelector("[data-booking-status]");
    cancel.disabled = true;
    try {
      await api.fn("me-api", { action: "cancel_booking", booking_id: cancel.dataset.cancelBooking });
      openId = cancel.dataset.cancelBooking || openId;
      const sb = await auth.whenReady();
      const { data } = await sb.auth.getSession();
      await load(data.session);
    } catch (err) {
      cancel.disabled = false;
      if (status) {
        status.textContent = err.message;
        status.classList.add("is-error");
      }
    }
  });

  auth
    .whenReady()
    .then((sb) => {
      sb.auth.onAuthStateChange((_event, session) => load(session));
      sb.auth.getSession().then(({ data }) => load(data.session));
    })
    .catch((err) => {
      root.innerHTML = `<p>${escapeHtml(err.message)}</p>`;
    });
})();
