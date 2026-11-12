(() => {
  const api = window.BULLDOGS_API;
  const root = document.querySelector("[data-ticket]");
  const query = new URLSearchParams(location.search);
  const hash = new URLSearchParams(location.hash.replace(/^#/, ""));
  const token = query.get("t") || hash.get("t") || query.get("c") || hash.get("c");
  if (!api || !root) return;
  if (!token) {
    root.innerHTML = `<p>Missing ticket.</p>`;
    return;
  }

  const escapeHtml = (value) =>
    String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  const paintQr = (host, text) => {
    if (typeof qrcode !== "function") return;
    const qr = qrcode(0, "M");
    qr.addData(text);
    qr.make();
    const img = document.createElement("img");
    img.src = qr.createDataURL(6, 2);
    img.width = 220;
    img.height = 220;
    img.alt = "";
    host.appendChild(img);
  };

  const when = (iso) =>
    new Intl.DateTimeFormat("en-GB", { dateStyle: "full", timeStyle: "short", timeZone: "Europe/London" }).format(new Date(iso));

  api.fn("public-booking", { action: "ticket", token }).then(async (payload) => {
    const attendees = payload.attendees || [];
    const event = attendees[0]?.event || payload.booking?.event || {};
    const cancelToken = payload.booking?.cancel_token || attendees[0]?.booking?.cancel_token || "";
    root.innerHTML = `
      <p class="eyebrow">Show at the door</p>
      <h1>${escapeHtml(event.title || "Ticket")}</h1>
      <p>${event.starts_at ? escapeHtml(when(event.starts_at)) : ""}</p>
      ${event.location ? `<p class="muted">${escapeHtml(event.location)}</p>` : ""}
      ${event.what_to_bring ? `<p class="muted">Bring: ${escapeHtml(event.what_to_bring)}</p>` : ""}
      <div class="ticket-grid" data-qrs></div>
      ${cancelToken ? `<p><a class="btn btn--ghost" href="${window.BULLDOGS.supabaseUrl}/functions/v1/public-booking?action=ics&c=${encodeURIComponent(cancelToken)}">Add to calendar</a> <a class="btn btn--ghost" href="cancel.html?c=${encodeURIComponent(cancelToken)}#c=${encodeURIComponent(cancelToken)}">Cancel this booking</a></p>` : ""}
      <p><a href="bookings.html">My Bookings</a></p>
    `;
    const grid = root.querySelector("[data-qrs]");
    for (const person of attendees) {
      if (!person.checkin_token) continue;
      const card = document.createElement("article");
      card.className = "ticket-card";
      const code = encodeURIComponent(person.checkin_token);
      const url = `${location.origin}${location.pathname}?t=${code}#t=${code}`;
      card.innerHTML = `<h3>${escapeHtml(person.attendee_name)}</h3>`;
      grid.appendChild(card);
      paintQr(card, url);
    }
  }).catch((err) => {
    root.innerHTML = `<p>${err.message || "Couldn't load this ticket."}</p>`;
  });
})();
