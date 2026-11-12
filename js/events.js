(() => {
  const { supabaseUrl, supabaseKey } = window.BULLDOGS || {};
  const api = window.BULLDOGS_API;
  const listEl = document.querySelector("[data-events]");
  const filtersEl = document.querySelector("[data-event-filters]");
  const banner = document.querySelector("[data-booking-banner]");
  const dialog = document.querySelector("[data-booking-dialog]");
  const form = document.querySelector("[data-booking-form]");
  const attendeesEl = document.querySelector("[data-attendees]");
  const waitDialog = document.querySelector("[data-waitlist-dialog]");
  const waitForm = document.querySelector("[data-waitlist-form]");
  const alertsForm = document.querySelector("[data-alerts]");
  if (!listEl || !supabaseUrl || !supabaseKey || !api) return;

  const money = (pence, currency = "gbp") =>
    new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency: currency.toUpperCase(),
      minimumFractionDigits: pence % 100 ? 2 : 0,
      maximumFractionDigits: 2,
    }).format((pence || 0) / 100);

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

  const parts = (iso, options) =>
    new Intl.DateTimeFormat("en-GB", { ...options, timeZone: "Europe/London" }).format(new Date(iso));

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

  const unavailable = (err, fallback) =>
    /unknown action/i.test(err?.message || "") ? fallback : err?.message || fallback;

  const params = new URLSearchParams(window.location.search);
  if (params.get("booking") === "success") showBanner("You're booked in. Check your email for tickets.");
  else if (params.get("booking") === "cancelled") showBanner("Payment was cancelled. Your place was not held.", true);

  const KINDS = ["Kids", "Training", "Showcases", "Other"];
  const kindOf = (event) => {
    const title = `${event.title} ${event.summary || ""}`.toLowerCase();
    if (/kid|taster|junior/.test(title)) return "Kids";
    if (/train/.test(title)) return "Training";
    if (/show|showcase|camp/.test(title)) return "Showcases";
    return "Other";
  };
  const cityOf = (event) => {
    const parts = (event.location || "").split(",").map((part) => part.trim()).filter(Boolean);
    return parts.length > 1 ? parts[parts.length - 1] : parts[0] || "";
  };

  const spacesLabel = (event) => {
    if (event.spaces_left == null) return "Places available";
    if (event.spaces_left === 0) return "Full";
    if (event.spaces_left === 1) return "1 place left";
    return `${event.spaces_left} places left`;
  };

  const actionFor = (event) => {
    if (event.is_bookable) {
      return `<button class="btn btn--accent btn--small" type="button" data-book="${escapeHtml(event.id)}">Book</button>`;
    }
    if (event.spaces_left === 0) {
      return `<button class="btn btn--accent btn--small" type="button" data-waitlist="${escapeHtml(event.id)}">Join waitlist</button>`;
    }
    return `<span class="btn btn--ghost btn--small" aria-disabled="true">Closed</span>`;
  };

  const capacityBar = (event) => {
    if (event.capacity == null || event.spaces_left == null) return `<div class="bar">Places available</div>`;
    const booked = event.capacity - event.spaces_left;
    const fill = event.capacity ? Math.min(100, Math.round((booked / event.capacity) * 100)) : 0;
    return `<div class="bar" style="--bar: ${fill}%">${escapeHtml(booked)} of ${escapeHtml(event.capacity)} booked<i></i></div>`;
  };

  const poster = (event) => {
    const meta = [
      escapeHtml(event.location),
      escapeHtml(parts(event.starts_at, { hour: "numeric", minute: "2-digit" })),
      event.age_range && `<span class="nowrap">Ages ${escapeHtml(event.age_range)}</span>`,
    ]
      .filter(Boolean)
      .join(" · ");
    const price = event.price_pence ? money(event.price_pence, event.currency) : "Free";
    const full = event.spaces_left === 0;
    const tag = full
      ? `<span class="tag pill pill--hot">Sold out</span>`
      : `<span class="tag pill">${escapeHtml(kindOf(event))}</span>`;
    return `
      <article class="poster${full ? " poster--full" : ""}">
        <figure>
          <img src="${photoFor(event.id)}" alt="" />
          ${tag}
        </figure>
        <div class="poster__body">
          <h3>${escapeHtml(event.title)}</h3>
          <p class="muted">${meta}</p>
          ${capacityBar(event)}
          <div class="poster__foot"><strong>${escapeHtml(price)}</strong>${actionFor(event)}</div>
        </div>
      </article>`;
  };

  const featureAction = (event) => {
    if (event.is_bookable) {
      return `<button class="btn btn--accent" type="button" data-book="${escapeHtml(event.id)}">Book now</button>`;
    }
    if (event.spaces_left === 0) {
      return `<button class="btn btn--accent" type="button" data-waitlist="${escapeHtml(event.id)}">Join waitlist</button>`;
    }
    return `<span class="btn btn--ghost" aria-disabled="true">Closed</span>`;
  };

  const clock = `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 8v5l3 2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
  const pin = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s6-5.2 6-10a6 6 0 1 0-12 0c0 4.8 6 10 6 10z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="11" r="2.2" fill="none" stroke="currentColor" stroke-width="2"/></svg>`;

  const feature = (event) => {
    const price = event.price_pence ? money(event.price_pence, event.currency) : "Free";
    const full = event.spaces_left === 0;
    const status = event.is_bookable ? untilLabel(event.starts_at) : full ? "Sold out" : "Closed";
    const at = (iso) => parts(iso, { hour: "2-digit", minute: "2-digit" });
    const time = event.ends_at ? `${at(event.starts_at)} – ${at(event.ends_at)}` : at(event.starts_at);
    return `
      <article class="ev-feature glass${full ? " is-full" : ""}">
        <figure>
          <img src="${photoFor(event.id)}" alt="" />
          <div class="date"><b>${escapeHtml(parts(event.starts_at, { day: "2-digit" }))}</b><span>${escapeHtml(parts(event.starts_at, { month: "short" }).toUpperCase())}</span></div>
        </figure>
        <div class="ev-feature__body">
          <span class="live">${escapeHtml(status)}</span>
          <h2>${escapeHtml(event.title)}</h2>
          ${event.summary ? `<p class="muted">${escapeHtml(event.summary)}</p>` : ""}
          <div class="ev-facts">
            <div><b>${pin}Where</b><p>${escapeHtml(event.location || "TBC")}</p></div>
            <div><b>${clock}When</b><p>${escapeHtml(time)}</p></div>
            <div><b>Ages</b><span>${escapeHtml(event.age_range || "All ages")}</span></div>
          </div>
          ${capacityBar(event)}
          <div class="ev-feature__foot">
            <strong>${escapeHtml(price)}</strong>
            ${featureAction(event)}
          </div>
        </div>
      </article>`;
  };

  let events = [];
  let filter = "all";
  let layout = "grid";

  const DECOR = [
    "assets/photos/web/round2-pack.jpg",
    "assets/photos/web/round2-herning.jpg",
    "assets/photos/web/arena-fear.jpg",
    "assets/photos/web/team-hero.jpg",
    "assets/photos/web/events-hero.jpg",
  ];

  const photoFor = (id) => {
    let n = 0;
    for (const ch of String(id || "")) n = (n + ch.charCodeAt(0)) % DECOR.length;
    return DECOR[n];
  };

  const untilLabel = (iso) => {
    const start = new Date(iso);
    if (Number.isNaN(start.getTime())) return "Next up";
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const day = new Date(start);
    day.setHours(0, 0, 0, 0);
    const days = Math.round((day - today) / 86400000);
    if (days < 0) return "Next up";
    if (days === 0) return "Next up · today";
    if (days === 1) return "Next up · tomorrow";
    return `Next up · in ${days} days`;
  };

  const filtered = () =>
    events.filter((event) => {
      if (filter === "all") return true;
      if (filter.startsWith("kind:")) return kindOf(event) === filter.slice(5);
      if (filter.startsWith("city:")) return cityOf(event) === filter.slice(5);
      return true;
    });

  const paintFilters = () => {
    if (!filtersEl) return;
    const kinds = KINDS.filter((kind) => events.some((event) => kindOf(event) === kind));
    const cities = [...new Set(events.map(cityOf).filter(Boolean))];
    const chips = [["all", "All"], ...kinds.map((kind) => [`kind:${kind}`, kind]), ...cities.map((city) => [`city:${city}`, city])];
    if (!chips.some(([id]) => id === filter)) filter = "all";
    filtersEl.hidden = events.length < 2;
    filtersEl.innerHTML = chips
      .map(
        ([id, label]) =>
          `<button type="button" class="chip${filter === id ? " is-on" : ""}" data-filter="${escapeHtml(id)}">${escapeHtml(label)}</button>`,
      )
      .join("");
  };

  const paintStats = () => {
    const statsEl = document.querySelector("[data-event-stats]");
    if (!statsEl) return;
    const cities = new Set(events.map(cityOf).filter(Boolean));
    statsEl.innerHTML = `
      <div class="glass"><b>${events.length}</b><span>Coming up</span></div>
      <div class="glass"><b>${cities.size}</b><span>${cities.size === 1 ? "City" : "Cities"}</span></div>`;
  };

  const renderEvents = () => {
    paintFilters();
    paintStats();
    const rows = filtered();
    if (!events.length) {
      listEl.innerHTML = `<p class="muted">No dates are open for booking yet. Check back soon.</p>`;
      return;
    }
    if (!rows.length) {
      listEl.innerHTML = `<p class="muted">Nothing matches that filter.</p>`;
      return;
    }
    const lead = rows.find((event) => event.is_bookable) || rows[0];
    const rest = rows.filter((event) => event !== lead);
    const more = rest.length
      ? `<h2 class="ev-more">All events</h2><div class="posters${layout === "list" ? " posters--list" : ""}">${rest.map(poster).join("")}</div>`
      : `<p class="muted events-only">That's the only date for now.</p>`;
    listEl.innerHTML = feature(lead) + more;
  };

  const attendeeBlock = (index) => `
    <fieldset class="attendee-block" data-attendee>
      <legend>Attendee ${index + 1}</legend>
      ${index > 0 ? `<button type="button" class="attendee-block__remove" data-remove-attendee>Remove</button>` : ""}
      <div class="field">
        <label>Name</label>
        <input name="attendee_name" type="text" required maxlength="200" aria-label="Attendee name" />
      </div>
      <div class="field-row">
        <div class="field">
          <label>Date of birth</label>
          <input name="attendee_date_of_birth" type="date" required aria-label="Date of birth" />
        </div>
        <div class="field">
          <label>Emergency contact</label>
          <input name="emergency_contact_name" type="text" required maxlength="200" aria-label="Emergency contact" />
        </div>
      </div>
      <div class="field">
        <label>Emergency phone</label>
        <input name="emergency_contact_phone" type="tel" required maxlength="40" aria-label="Emergency phone" />
      </div>
      <div class="field">
        <label>Medical / allergy notes</label>
        <textarea name="medical_notes" maxlength="2000" placeholder="Anything coaches should know" aria-label="Medical notes"></textarea>
      </div>
    </fieldset>`;

  const renumber = () => {
    attendeesEl?.querySelectorAll("[data-attendee]").forEach((block, i) => {
      const legend = block.querySelector("legend");
      if (legend) legend.textContent = `Attendee ${i + 1}`;
    });
  };

  let step = 0;
  const stepEls = () => [...(form?.querySelectorAll("[data-step]") || [])];

  const paintSteps = () => {
    stepEls().forEach((el, index) => {
      el.hidden = index !== step;
    });
    const back = form?.querySelector("[data-step-back]");
    const next = form?.querySelector("[data-step-next]");
    if (back) back.hidden = step === 0;
    if (next) next.hidden = step >= 2;
    form?.querySelectorAll("[data-book-steps] span").forEach((el, index) => {
      el.classList.toggle("is-on", index === step);
      el.classList.toggle("is-done", index < step);
    });
  };

  const validateStep = () => {
    const current = stepEls()[step];
    if (!current) return true;
    const fields = [...current.querySelectorAll("input, select, textarea")];
    for (const field of fields) {
      if (!field.checkValidity()) {
        field.reportValidity();
        return false;
      }
    }
    return true;
  };

  const goToStep = (nextStep) => {
    step = nextStep;
    paintSteps();
    if (!dialog?.open) return;
    stepEls()[step]?.querySelector("input, select, textarea")?.focus();
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
    goToStep(0);
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

  form?.querySelector("[data-step-next]")?.addEventListener("click", () => {
    if (!validateStep()) return;
    if (step < 2) goToStep(step + 1);
  });

  form?.querySelector("[data-step-back]")?.addEventListener("click", () => {
    if (step > 0) goToStep(step - 1);
  });

  const openBooking = (event) => {
    if (!event?.is_bookable || !dialog) {
      showBanner("That event is no longer open to book.", true);
      return;
    }
    fillForm(event);
    dialog.showModal();
    stepEls()[0]?.querySelector("input, select, textarea")?.focus();
  };

  const openWaitlist = (event) => {
    if (!event || !waitDialog || !waitForm) return;
    waitForm.event_id.value = event.id;
    waitForm.querySelector("[data-waitlist-title]").textContent = event.title;
    waitForm.querySelector(".form-status").textContent = "";
    const session = window.BULLDOGS_SESSION;
    if (session?.user) {
      const name = session.user.user_metadata?.full_name;
      if (name && waitForm.full_name && !waitForm.full_name.value) waitForm.full_name.value = name;
      if (waitForm.email && !waitForm.email.value) waitForm.email.value = session.user.email;
    }
    waitDialog.showModal();
  };

  const loadEvents = async () => {
    listEl.innerHTML = `<p class="muted">Loading dates…</p>`;
    events = await api.rpc("list_upcoming_events");
    renderEvents();
  };

  filtersEl?.addEventListener("click", (e) => {
    const chip = e.target.closest("[data-filter]");
    if (!chip) return;
    filter = chip.getAttribute("data-filter") || "all";
    renderEvents();
  });

  listEl.addEventListener("click", (e) => {
    const book = e.target.closest("[data-book]");
    if (book) {
      openBooking(events.find((item) => item.id === book.getAttribute("data-book")));
      return;
    }
    const wait = e.target.closest("[data-waitlist]");
    if (wait) openWaitlist(events.find((item) => item.id === wait.getAttribute("data-waitlist")));
  });

  document.querySelector("[data-event-layout]")?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-layout]");
    if (!btn) return;
    layout = btn.getAttribute("data-layout") || "grid";
    document.querySelectorAll("[data-layout]").forEach((el) => el.classList.toggle("is-on", el === btn));
    renderEvents();
  });

  dialog?.querySelectorAll("[data-close-booking]").forEach((btn) => {
    btn.addEventListener("click", () => dialog.close());
  });

  waitDialog?.querySelectorAll("[data-close-waitlist]").forEach((btn) => {
    btn.addEventListener("click", () => waitDialog.close());
  });

  waitForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const status = waitForm.querySelector(".form-status");
    const submit = waitForm.querySelector('[type="submit"]');
    status.textContent = "Saving…";
    status.classList.remove("is-error");
    submit.disabled = true;
    try {
      await api.fn("public-booking", {
        action: "join_waitlist",
        event_id: new FormData(waitForm).get("event_id"),
        full_name: waitForm.full_name.value,
        email: waitForm.email.value,
      });
      waitDialog.close();
      showBanner("You're on the waitlist. We'll email you if a place opens.");
    } catch (err) {
      status.textContent = unavailable(err, "The waitlist isn't available yet.");
      status.classList.add("is-error");
    } finally {
      submit.disabled = false;
    }
  });

  alertsForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const status = alertsForm.querySelector(".form-status");
    const submit = alertsForm.querySelector('[type="submit"]');
    status.textContent = "Saving…";
    status.classList.remove("is-error");
    submit.disabled = true;
    try {
      await api.fn("public-booking", {
        action: "subscribe_alerts",
        email: new FormData(alertsForm).get("email"),
      });
      alertsForm.reset();
      status.textContent = "You're on the list. We'll email you when a new event goes live.";
    } catch (err) {
      status.textContent = unavailable(err, "Alerts aren't available yet.");
      status.classList.add("is-error");
    } finally {
      submit.disabled = false;
    }
  });

  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (step < 2) {
      if (validateStep()) goToStep(step + 1);
      return;
    }
    if (!validateStep()) return;
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

    const minor = attendees.some((person) => {
      const dob = new Date(person.date_of_birth);
      if (Number.isNaN(dob.getTime())) return false;
      const now = new Date();
      let age = now.getFullYear() - dob.getFullYear();
      const month = now.getMonth() - dob.getMonth();
      if (month < 0 || (month === 0 && now.getDate() < dob.getDate())) age -= 1;
      return age < 18;
    });
    if (minor && data.get("guardian_confirmed") !== "on") {
      const box = form.querySelector('[name="guardian_confirmed"]');
      box.setCustomValidity("Confirm you are the parent or guardian for anyone under 18.");
      box.reportValidity();
      box.setCustomValidity("");
      return;
    }

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

  loadEvents()
    .then(() => {
      const bookId = params.get("book") || new URLSearchParams(location.hash.replace(/^#/, "")).get("book");
      if (!bookId) return;
      const event = events.find((item) => item.id === bookId);
      if (!event) {
        showBanner("That event is no longer open to book.", true);
        return;
      }
      if (event.is_bookable) openBooking(event);
      else if (event.spaces_left === 0) openWaitlist(event);
      else showBanner("That event is no longer open to book.", true);
    })
    .catch(() => {
      listEl.innerHTML = `<p class="muted">Couldn't load events right now. Refresh the page or try again later.</p>`;
    });
})();
