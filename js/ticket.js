(() => {
  const api = window.BULLDOGS_API;
  const root = document.querySelector("[data-ticket]");
  const params = new URLSearchParams(location.search);
  const token = params.get("t") || params.get("c");
  if (!api || !root) return;
  if (!token) {
    root.innerHTML = `<p>Missing ticket.</p>`;
    return;
  }

  const when = (iso) =>
    new Intl.DateTimeFormat("en-GB", { dateStyle: "full", timeStyle: "short", timeZone: "Europe/London" }).format(new Date(iso));

  api.fn("public-booking", { action: "ticket", token }).then(async (payload) => {
    const attendees = payload.attendees || [];
    const event = attendees[0]?.event || payload.booking?.event || {};
    root.innerHTML = `
      <p class="eyebrow">Show at the door</p>
      <h1>${event.title || "Ticket"}</h1>
      <p>${event.starts_at ? when(event.starts_at) : ""}</p>
      ${event.location ? `<p class="muted">${event.location}</p>` : ""}
      ${event.what_to_bring ? `<p class="muted">Bring: ${event.what_to_bring}</p>` : ""}
      <div class="ticket-grid" data-qrs></div>
      ${params.get("c") ? `<p><a class="btn btn--ghost" href="${window.BULLDOGS.supabaseUrl}/functions/v1/public-booking?action=ics&c=${params.get("c")}">Add to calendar</a> <a class="btn btn--ghost" href="cancel.html?c=${params.get("c")}">Cancel this booking</a></p>` : ""}
    `;
    const grid = root.querySelector("[data-qrs]");
    for (const person of attendees) {
      if (!person.checkin_token) continue;
      const card = document.createElement("article");
      card.className = "ticket-card";
      const canvas = document.createElement("canvas");
      const url = `${location.origin}${location.pathname}?t=${person.checkin_token}`;
      card.innerHTML = `<h3>${person.attendee_name}</h3>`;
      card.appendChild(canvas);
      grid.appendChild(card);
      if (window.QRCode) await window.QRCode.toCanvas(canvas, url, { width: 220, margin: 1 });
    }
  }).catch((err) => {
    root.innerHTML = `<p>${err.message || "Couldn't load this ticket."}</p>`;
  });
})();
