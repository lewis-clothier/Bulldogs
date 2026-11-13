(() => {
  const api = window.BULLDOGS_API;

  const alertsDialog = document.querySelector("[data-alerts-dialog]");
  const alertsOpen = document.querySelector("[data-home-alerts-open]");
  const alertsForm = document.querySelector("[data-home-alerts]");
  const signedIn = () => Boolean(window.BULLDOGS_SESSION?.user?.email);

  const paintAlertsDialog = (soon) => {
    alertsForm?.querySelector("[data-alerts-guest]")?.toggleAttribute("hidden", soon);
    alertsForm?.querySelector("[data-alerts-lead]")?.toggleAttribute("hidden", soon);
    const note = alertsForm?.querySelector("[data-alerts-soon]");
    if (note) note.hidden = !soon;
    const status = alertsForm?.querySelector(".form-status");
    if (status) {
      status.textContent = "";
      status.classList.remove("is-error");
    }
  };

  alertsOpen?.addEventListener("click", (event) => {
    if (!alertsDialog) return;
    event.preventDefault();
    const soon = signedIn();
    paintAlertsDialog(soon);
    alertsDialog.showModal();
    if (!soon) alertsForm?.querySelector("input[name='email']")?.focus();
  });

  alertsDialog?.querySelector("[data-close-alerts]")?.addEventListener("click", () => alertsDialog.close());
  window.BULLDOGS_AUTH?.backdropClose(alertsDialog, () => alertsDialog.close());
  alertsDialog?.querySelector("[data-alerts-auth]")?.addEventListener("click", () => {
    alertsDialog.close();
    window.BULLDOGS_AUTH?.open({ mode: "signin" });
  });

  alertsForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const status = alertsForm.querySelector(".form-status");
    const submit = alertsForm.querySelector('[type="submit"]');
    const email = new FormData(alertsForm).get("email");
    status.textContent = "Saving…";
    status.classList.remove("is-error");
    submit.disabled = true;
    try {
      await api.fn("public-booking", { action: "subscribe_alerts", email });
      alertsForm.reset();
      status.textContent = "You're on the list. We'll email you when a new event goes live.";
    } catch (err) {
      const message = /unknown action/i.test(err?.message || "") ? "Alerts aren't available yet." : err?.message || "Alerts aren't available yet.";
      status.textContent = message;
      status.classList.add("is-error");
    } finally {
      submit.disabled = false;
    }
  });

  const rail = document.querySelector("[data-home-events]");
  if (!api || !rail) return;

  const escapeHtml = (value) =>
    String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  const parts = (iso, options) => new Intl.DateTimeFormat("en-GB", { ...options, timeZone: "Europe/London" }).format(new Date(iso));

  const clock = `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 8v5l3 2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
  const pin = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s6-5.2 6-10a6 6 0 1 0-12 0c0 4.8 6 10 6 10z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="11" r="2.2" fill="none" stroke="currentColor" stroke-width="2"/></svg>`;

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
    const action = event.is_bookable
      ? `<a class="btn btn--accent btn--small" href="events.html?book=${encodeURIComponent(event.id)}#book=${encodeURIComponent(event.id)}">Book</a>`
      : `<span class="btn btn--ghost btn--small" aria-disabled="true">${event.spaces_left === 0 ? "Sold out" : "Closed"}</span>`;
    return `
      <div class="home-slot">
        <article class="home-event${isNext ? " home-event--next" : ""}">
          <div class="home-event__photo">
            <img src="assets/photos/web/events-hero.jpg" alt="" />
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
          <div class="home-event__foot">${action}</div>
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

  api
    .rpc("list_upcoming_events")
    .then((events) => {
      if (!events.length) {
        rail.innerHTML = `<p class="muted">No dates are open for booking yet. Check back soon.</p>`;
        return;
      }
      const next = events.find((event) => event.is_bookable) || events[0];
      rail.innerHTML = row(next, true);
    })
    .catch(() => {
      rail.innerHTML = `<p class="muted">Couldn't load events right now. Refresh the page or try again later.</p>`;
    });
})();
