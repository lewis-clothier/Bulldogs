(() => {
  const { supabaseUrl, supabaseKey } = window.BULLDOGS || {};
  const api = window.BULLDOGS_API;
  const listEl = document.querySelector("[data-events]");
  const banner = document.querySelector("[data-booking-banner]");
  const dialog = document.querySelector("[data-booking-dialog]");
  const form = document.querySelector("[data-booking-form]");
  const attendeesEl = document.querySelector("[data-attendees]");
  if (!listEl || !supabaseUrl || !supabaseKey || !api) return;

  const money = (pence, currency = "gbp") =>
    new Intl.NumberFormat("en-GB", { style: "currency", currency: currency.toUpperCase() }).format((pence || 0) / 100);

  const when = (iso) =>
    new Intl.DateTimeFormat("en-GB", {
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: "Europe/London",
    }).format(new Date(iso));

  const escapeHtml = (value) =>
    String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  const showBanner = (message, isError = false) => {
    if (!banner) return;
    banner.hidden = false;
    banner.textContent = message;
    banner.classList.toggle("is-error", isError);
  };

  const params = new URLSearchParams(window.location.search);
  if (params.get("booking") === "success") showBanner("You're booked in. Check your email for tickets.");
  else if (params.get("booking") === "cancelled") showBanner("Payment was cancelled. Your place was not held.", true);

  const spacesLabel = (event) => {
    if (event.spaces_left == null) return "Places available";
    if (event.spaces_left === 0) return "Full";
    if (event.spaces_left === 1) return "1 place left";
    return `${event.spaces_left} places left`;
  };

  const renderEvents = (events) => {
    if (!events.length) {
      listEl.innerHTML = `<p class="muted">No dates are open for booking yet. Check back soon.</p>`;
      return;
    }
    listEl.innerHTML = events
      .map((event, i) => {
        const extras = [
          event.age_range && `Ages ${escapeHtml(event.age_range)}`,
          event.what_to_bring && escapeHtml(event.what_to_bring),
        ].filter(Boolean);
        return `
          <article class="event">
            <span class="event__label">${String(i + 1).padStart(2, "0")}</span>
            <div>
              <h3>${escapeHtml(event.title)}</h3>
              <p>${escapeHtml(event.summary || event.description || "")}</p>
              ${event.location ? `<p class="event__where">${escapeHtml(event.location)}</p>` : ""}
              ${extras.length ? `<p class="muted">${extras.join(" · ")}</p>` : ""}
            </div>
            <div class="event__aside">
              <div class="event__meta">${escapeHtml(when(event.starts_at))}<br />${money(event.price_pence, event.currency)} · ${escapeHtml(spacesLabel(event))}</div>
              ${
                event.is_bookable
                  ? `<button class="btn btn--accent" type="button" data-book="${escapeHtml(event.id)}">Book</button>`
                  : `<button class="btn btn--ghost" type="button" disabled>${event.spaces_left === 0 ? "Sold out" : "Closed"}</button>`
              }
            </div>
          </article>`;
      })
      .join("");
  };

  const attendeeBlock = (index) => `
    <fieldset class="attendee-block" data-attendee>
      <legend>Attendee ${index + 1}</legend>
      ${index > 0 ? `<button type="button" class="attendee-block__remove" data-remove-attendee>Remove</button>` : ""}
      <div class="field">
        <label>Name</label>
        <input name="attendee_name" type="text" required maxlength="200" />
      </div>
      <div class="field-row">
        <div class="field">
          <label>Date of birth</label>
          <input name="attendee_date_of_birth" type="date" required />
        </div>
        <div class="field">
          <label>Emergency contact</label>
          <input name="emergency_contact_name" type="text" required maxlength="200" />
        </div>
      </div>
      <div class="field">
        <label>Emergency phone</label>
        <input name="emergency_contact_phone" type="tel" required maxlength="40" />
      </div>
      <div class="field">
        <label>Medical / allergy notes</label>
        <textarea name="medical_notes" maxlength="2000" placeholder="Anything coaches should know"></textarea>
      </div>
    </fieldset>`;

  const renumber = () => {
    attendeesEl?.querySelectorAll("[data-attendee]").forEach((block, i) => {
      const legend = block.querySelector("legend");
      if (legend) legend.textContent = `Attendee ${i + 1}`;
    });
  };

  const fillForm = (event) => {
    if (!form) return;
    form.event_id.value = event.id;
    form.querySelector("[data-booking-title]").textContent = event.title;
    form.querySelector("[data-booking-when]").textContent = `${when(event.starts_at)} · ${money(event.price_pence, event.currency)}`;
    form.querySelector(".form-status").textContent = "";
    const session = window.BULLDOGS_SESSION;
    if (session?.user) {
      const name = session.user.user_metadata?.full_name;
      if (name && form.full_name) form.full_name.value = name;
      if (form.email) form.email.value = session.user.email;
    }
    if (attendeesEl) attendeesEl.innerHTML = attendeeBlock(0);
  };

  window.BULLDOGS_AUTH?.bindCheckout(form?.querySelector("[data-auth-checkout]"));

  form?.querySelector("[data-add-attendee]")?.addEventListener("click", () => {
    const count = attendeesEl.querySelectorAll("[data-attendee]").length;
    if (count >= 8) return;
    attendeesEl.insertAdjacentHTML("beforeend", attendeeBlock(count));
    renumber();
  });

  attendeesEl?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-remove-attendee]");
    if (!btn) return;
    btn.closest("[data-attendee]")?.remove();
    renumber();
  });

  const loadEvents = async () => {
    listEl.innerHTML = `<p class="muted">Loading dates…</p>`;
    renderEvents(await api.rpc("list_upcoming_events"));
  };

  listEl.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-book]");
    if (!btn || !dialog) return;
    const events = await api.rpc("list_upcoming_events");
    const event = events.find((item) => item.id === btn.getAttribute("data-book"));
    if (!event?.is_bookable) {
      showBanner("That event is no longer open to book.", true);
      return;
    }
    fillForm(event);
    dialog.showModal();
  });

  dialog?.querySelectorAll("[data-close-booking]").forEach((btn) => {
    btn.addEventListener("click", () => dialog.close());
  });

  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const status = form.querySelector(".form-status");
    const submitBtns = [...form.querySelectorAll('[type="submit"]')];
    const data = new FormData(form);
    const attendees = [...form.querySelectorAll("[data-attendee]")].map((block) => ({
      name: block.querySelector('[name="attendee_name"]').value,
      date_of_birth: block.querySelector('[name="attendee_date_of_birth"]').value,
      emergency_contact_name: block.querySelector('[name="emergency_contact_name"]').value,
      emergency_contact_phone: block.querySelector('[name="emergency_contact_phone"]').value,
      medical_notes: block.querySelector('[name="medical_notes"]').value,
    }));

    status.textContent = "Holding your place…";
    status.classList.remove("is-error");
    submitBtns.forEach((btn) => {
      btn.disabled = true;
    });

    try {
      const payload = await api.fn("create-event-checkout", {
        event_id: data.get("event_id"),
        full_name: data.get("full_name"),
        email: data.get("email"),
        phone: data.get("phone") || null,
        attendees,
        newsletter_opt_in: data.get("newsletter_opt_in") === "on",
        terms_accepted: data.get("terms_accepted") === "on",
        photo_consent: data.get("photo_consent") === "on",
        guardian_confirmed: data.get("guardian_confirmed") === "on",
      });
      if (!payload.url) throw new Error("Couldn't start booking");
      window.location.assign(payload.url);
    } catch (err) {
      status.textContent = err.message || "Couldn't start booking. Please try again.";
      status.classList.add("is-error");
      submitBtns.forEach((btn) => {
        btn.disabled = false;
      });
    }
  });

  loadEvents().catch(() => {
    listEl.innerHTML = `<p class="muted">Couldn't load events right now. Refresh the page or try again later.</p>`;
  });
})();
