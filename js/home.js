(() => {
  const api = window.BULLDOGS_API;
  const mediaUrl = (path) => window.BULLDOGS_MEDIA?.publicMediaUrl?.(path) || path;

  const rail = document.querySelector("[data-home-events]");
  const teamRail = document.querySelector("#home-team");
  const infoDialog = document.querySelector("[data-event-info-dialog]");
  if (!api || !rail) return;

  const eventPhoto = (event) => {
    const cover = String(event?.cover_image || "").trim();
    if (cover && (/^https?:\/\//i.test(cover) || cover.startsWith("assets/"))) return cover;
    return window.BULLDOGS_SITE_MEDIA?.home_event_fallback || mediaUrl("events/events-hero.jpg");
  };

  const escapeHtml = (value) =>
    String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  const parts = (iso, options) => new Intl.DateTimeFormat("en-GB", { ...options, timeZone: "Europe/London" }).format(new Date(iso));

  const money = (pence, currency = "gbp") =>
    new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency: currency.toUpperCase(),
      minimumFractionDigits: pence % 100 ? 2 : 0,
      maximumFractionDigits: 2,
    }).format((pence || 0) / 100);

  const clock = `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 8v5l3 2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
  const pin = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s6-5.2 6-10a6 6 0 1 0-12 0c0 4.8 6 10 6 10z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="11" r="2.2" fill="none" stroke="currentColor" stroke-width="2"/></svg>`;
  const person = `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="3.2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M5.5 19.5c1.2-3.2 3.5-4.8 6.5-4.8s5.3 1.6 6.5 4.8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;

  const whoFor = (range) => {
    const value = String(range || "").trim();
    if (!value) return "All ages";
    if (/^ages\b/i.test(value)) return value;
    return `Ages ${value}`;
  };

  const spacesLabel = (event) => {
    if (event.spaces_left == null) return "Places available";
    if (event.spaces_left === 0) return "Full";
    if (event.spaces_left === 1) return "1 place left";
    return `${event.spaces_left} places left`;
  };

  const bookHref = (event) => `events.html?book=${encodeURIComponent(event.id)}#book=${encodeURIComponent(event.id)}`;

  const multiline = (value) =>
    escapeHtml(value)
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => `<p>${line}</p>`)
      .join("");

  let currentEvent = null;

  const openEventInfo = (event) => {
    if (!event || !infoDialog) return;
    currentEvent = event;
    const at = (iso) => parts(iso, { hour: "2-digit", minute: "2-digit" });
    const date = parts(event.starts_at, { weekday: "short", day: "numeric", month: "short", year: "numeric" });
    const clockTime = event.ends_at ? `${at(event.starts_at)} – ${at(event.ends_at)}` : at(event.starts_at);
    const price = event.price_pence ? money(event.price_pence, event.currency) : "Free";
    infoDialog.querySelector("[data-event-info-title]").textContent = event.title;
    infoDialog.querySelector("[data-event-info-when]").textContent = `${date} · ${clockTime}`;
    infoDialog.querySelector("[data-event-info-price]").textContent = price;
    infoDialog.querySelector("[data-event-info-facts]").innerHTML = `
      <div><b>${pin}Where</b><p>${escapeHtml(event.location || "TBC")}</p></div>
      <div><b>${clock}When</b><p>${escapeHtml(date)} · ${escapeHtml(clockTime)}</p></div>
      <div><b>${person}Who</b><p>${escapeHtml(whoFor(event.age_range))}</p></div>
      <div><b>Places</b><p>${escapeHtml(spacesLabel(event))}</p></div>`;
    const blocks = [];
    if (event.summary) blocks.push(`<section><h3>Summary</h3>${multiline(event.summary)}</section>`);
    if (event.description) blocks.push(`<section><h3>Description</h3>${multiline(event.description)}</section>`);
    if (event.what_to_bring) blocks.push(`<section><h3>What to bring</h3>${multiline(event.what_to_bring)}</section>`);
    if (!blocks.length) blocks.push(`<p class="muted">No extra details for this event yet.</p>`);
    infoDialog.querySelector("[data-event-info-copy]").innerHTML = blocks.join("");
    const acts = infoDialog.querySelector("[data-event-info-acts]");
    if (event.is_bookable) {
      acts.innerHTML = `<button class="btn btn--accent" type="button" data-home-book>Book now</button>`;
    } else if (event.spaces_left === 0) {
      acts.innerHTML = `<button class="btn btn--accent" type="button" data-home-book>Join waitlist</button>`;
    } else {
      acts.innerHTML = `<span class="btn btn--ghost" aria-disabled="true">Closed</span>`;
    }
    infoDialog.showModal();
  };

  const row = (event, isNext) => {
    const at = (iso) => parts(iso, { hour: "2-digit", minute: "2-digit" });
    const time = event.ends_at ? `${at(event.starts_at)} – ${at(event.ends_at)}` : at(event.starts_at);
    const booked = event.capacity != null && event.spaces_left != null ? event.capacity - event.spaces_left : null;
    const fill = event.capacity ? Math.min(100, Math.round((booked / event.capacity) * 100)) : 0;
    const places =
      event.spaces_left == null
        ? ""
        : `${escapeHtml(event.spaces_left)} ${event.spaces_left === 1 ? "space" : "spaces"} left`;
    const track = booked == null ? "" : `<div class="home-event__bar" style="--bar: ${fill}%"><i></i></div>`;
    const book = event.is_bookable
      ? `<a class="btn btn--accent btn--small" href="${escapeHtml(bookHref(event))}">Book</a>`
      : `<span class="btn btn--ghost btn--small" aria-disabled="true">${event.spaces_left === 0 ? "Sold out" : "Closed"}</span>`;
    return `
      <div class="home-slot">
        <article class="home-event${isNext ? " home-event--next" : ""}">
          <div class="home-event__photo">
            <img src="${escapeHtml(eventPhoto(event))}" alt="" data-editable-media="event" data-event-id="${escapeHtml(event.id)}" />
            <p class="home-event__date">
              <b>${escapeHtml(parts(event.starts_at, { day: "2-digit" }))}</b>
              <span>${escapeHtml(parts(event.starts_at, { month: "short" }).toUpperCase())}</span>
            </p>
          </div>
          <div class="home-event__copy">
            <h3>${escapeHtml(event.title)}</h3>
            <div class="home-event__meta">
              <p class="home-event__time">${clock}<span>${escapeHtml(time)}</span></p>
              <p class="home-event__where">${pin}<span>${escapeHtml(event.location || "Location to be confirmed")}</span></p>
            </div>
            ${places || track ? `<div class="home-event__status">${places ? `<p class="home-event__left">${places}</p>` : ""}${track}</div>` : ""}
          </div>
          <div class="home-event__foot">
            <button class="btn btn--ghost btn--small" type="button" data-event-info="${escapeHtml(event.id)}">More info</button>
            ${book}
          </div>
        </article>
      </div>`;
  };

  const scrollRail = (selector, direction) => {
    document.querySelector(selector)?.scrollBy({ left: direction * 340, behavior: "smooth" });
  };
  document.querySelectorAll("[data-rail-next]").forEach((btn) => {
    btn.addEventListener("click", () => scrollRail(btn.getAttribute("data-rail-next"), 1));
  });
  document.querySelectorAll("[data-rail-prev]").forEach((btn) => {
    btn.addEventListener("click", () => scrollRail(btn.getAttribute("data-rail-prev"), -1));
  });

  rail.addEventListener("click", (e) => {
    const info = e.target.closest("[data-event-info]");
    if (!info || !currentEvent) return;
    if (info.getAttribute("data-event-info") !== currentEvent.id) return;
    openEventInfo(currentEvent);
  });

  infoDialog?.querySelectorAll("[data-close-event-info]").forEach((btn) => {
    btn.addEventListener("click", () => infoDialog.close());
  });

  infoDialog?.addEventListener("click", (e) => {
    const book = e.target.closest("[data-home-book]");
    if (!book || !currentEvent) return;
    window.location.assign(bookHref(currentEvent));
  });

  const paintHomeTeam = (athletes) => {
    if (!teamRail) return;
    const home = (athletes || []).filter((row) => row.show_on_home && row.image_url);
    const list = home.length ? home : (athletes || []).filter((row) => row.image_url).slice(0, 8);
    if (!list.length) return;
    teamRail.innerHTML = list
      .map((athlete) => {
        const kit = athlete.kit_number != null ? `#${athlete.kit_number}` : athlete.role || "Athlete";
        return `<a class="athlete-card" href="team.html"><img src="${escapeHtml(athlete.image_url)}" alt="" data-editable-media="athlete" data-athlete-id="${escapeHtml(athlete.id)}" /><span><b>${escapeHtml(athlete.name)}</b><small>${escapeHtml(kit)}</small></span></a>`;
      })
      .join("");
  };

  api
    .rpc("list_upcoming_events")
    .then((events) => {
      if (!events.length) {
        rail.innerHTML = `<p class="muted">No dates are open for booking yet. Check back soon.</p>`;
        return;
      }
      const next = events.find((event) => event.is_bookable) || events[0];
      currentEvent = next;
      rail.innerHTML = row(next, true);
    })
    .catch(() => {
      rail.innerHTML = `<p class="muted">Couldn't load events right now. Refresh the page or try again later.</p>`;
    });

  api
    .rpc("list_athletes")
    .then((athletes) => {
      paintHomeTeam(athletes);
      window.BULLDOGS_MEDIA_EDIT?.refresh?.();
    })
    .catch(() => {});
})();
