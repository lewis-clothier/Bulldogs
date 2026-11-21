(() => {
  const { supabaseUrl, supabaseKey } = window.BULLDOGS || {};
  const api = window.BULLDOGS_API;
  const listEl = document.querySelector("[data-events]");
  const banner = document.querySelector("[data-booking-banner]");
  const dialog = document.querySelector("[data-booking-dialog]");
  const form = document.querySelector("[data-booking-form]");
  const attendeesEl = document.querySelector("[data-attendees]");
  const waitDialog = document.querySelector("[data-waitlist-dialog]");
  const waitForm = document.querySelector("[data-waitlist-form]");
  const infoDialog = document.querySelector("[data-event-info-dialog]");
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

  const spacesLabel = (event) => {
    if (event.spaces_left == null) return "Spaces available";
    if (event.spaces_left === 0) return "Full";
    if (event.spaces_left === 1) return "1 space left";
    return `${event.spaces_left} spaces left`;
  };

  const infoBtn = (event, size = "small") =>
    `<button class="btn btn--ghost${size === "small" ? " btn--small" : ""}" type="button" data-event-info="${escapeHtml(event.id)}">More info</button>`;

  const actionFor = (event) => {
    if (event.is_bookable) {
      return `${infoBtn(event)}<button class="btn btn--accent btn--small" type="button" data-book="${escapeHtml(event.id)}">Book</button>`;
    }
    if (event.spaces_left === 0) {
      return `${infoBtn(event)}<button class="btn btn--accent btn--small" type="button" data-waitlist="${escapeHtml(event.id)}">Join waitlist</button>`;
    }
    return `${infoBtn(event)}<span class="btn btn--ghost btn--small" aria-disabled="true">Closed</span>`;
  };

  const capacityBar = (event) => {
    if (event.capacity == null || event.spaces_left == null) return `<div class="bar">Spaces available</div>`;
    const booked = event.capacity - event.spaces_left;
    const fill = event.capacity ? Math.min(100, Math.round((booked / event.capacity) * 100)) : 0;
    return `<div class="bar" style="--bar: ${fill}%">${escapeHtml(spacesLabel(event))}<i></i></div>`;
  };

  const poster = (event, photo) => {
    const meta = [
      escapeHtml(event.location),
      escapeHtml(parts(event.starts_at, { hour: "numeric", minute: "2-digit" })),
      event.age_range && `<span class="nowrap">Ages ${escapeHtml(event.age_range)}</span>`,
    ]
      .filter(Boolean)
      .join(" · ");
    const price = event.price_pence ? money(event.price_pence, event.currency) : "Free";
    const full = event.spaces_left === 0;
    const tag = full ? `<span class="tag pill pill--hot">Sold out</span>` : "";
    return `
      <article class="poster${full ? " poster--full" : ""}">
        <figure>
          <img src="${escapeHtml(photo)}" alt="" data-editable-media="event" data-event-id="${escapeHtml(event.id)}" />
          <div class="date"><b>${escapeHtml(parts(event.starts_at, { day: "2-digit" }))}</b><span>${escapeHtml(parts(event.starts_at, { month: "short" }).toUpperCase())}</span></div>
          ${tag}
        </figure>
        <div class="poster__body">
          <h3>${escapeHtml(event.title)}</h3>
          <p class="muted">${meta}</p>
          ${capacityBar(event)}
          <div class="poster__foot"><strong>${escapeHtml(price)}</strong><div class="poster__acts">${actionFor(event)}</div></div>
        </div>
      </article>`;
  };

  const featureAction = (event) => {
    if (event.is_bookable) {
      return `${infoBtn(event, "regular")}<button class="btn btn--accent" type="button" data-book="${escapeHtml(event.id)}">Book now</button>`;
    }
    if (event.spaces_left === 0) {
      return `${infoBtn(event, "regular")}<button class="btn btn--accent" type="button" data-waitlist="${escapeHtml(event.id)}">Join waitlist</button>`;
    }
    return `${infoBtn(event, "regular")}<span class="btn btn--ghost" aria-disabled="true">Closed</span>`;
  };

  const clock = `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 8v5l3 2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
  const pin = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s6-5.2 6-10a6 6 0 1 0-12 0c0 4.8 6 10 6 10z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="11" r="2.2" fill="none" stroke="currentColor" stroke-width="2"/></svg>`;
  const person = `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="3.2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M5.5 19.5c1.2-3.2 3.5-4.8 6.5-4.8s5.3 1.6 6.5 4.8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
  const whoFor = (range) => {
    const value = String(range || "").trim();
    if (!value) return "All ages";
    if (/^ages\b/i.test(value)) return value;
    return `Ages ${value}`;
  };

  const feature = (event, photo) => {
    const price = event.price_pence ? money(event.price_pence, event.currency) : "Free";
    const full = event.spaces_left === 0;
    const status = event.is_bookable ? untilLabel(event.starts_at) : full ? "Sold out" : "Closed";
    const at = (iso) => parts(iso, { hour: "2-digit", minute: "2-digit" });
    const date = parts(event.starts_at, { weekday: "short", day: "numeric", month: "short" });
    const clockTime = event.ends_at ? `${at(event.starts_at)} – ${at(event.ends_at)}` : at(event.starts_at);
    const time = `<span data-when-date>${escapeHtml(date)}</span><span data-when-sep> · </span><span data-when-time>${escapeHtml(clockTime)}</span>`;
    return `
      <article class="ev-feature glass${full ? " is-full" : ""}">
        <figure>
          <img src="${escapeHtml(photo)}" alt="" data-editable-media="event" data-event-id="${escapeHtml(event.id)}" />
          <div class="date"><b>${escapeHtml(parts(event.starts_at, { day: "2-digit" }))}</b><span>${escapeHtml(parts(event.starts_at, { month: "short" }).toUpperCase())}</span></div>
        </figure>
        <div class="ev-feature__body">
          <span class="live">${escapeHtml(status)}</span>
          <h2>${escapeHtml(event.title)}</h2>
          ${event.summary ? `<p class="muted">${escapeHtml(event.summary)}</p>` : ""}
          <div class="ev-facts">
            <div><b>${pin}Where</b><p>${escapeHtml(event.location || "TBC")}</p></div>
            <div><b>${clock}When</b><p class="ev-when" data-when>${time}</p></div>
            <div><b>${person}Who</b><p>${escapeHtml(whoFor(event.age_range))}</p></div>
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

  const mediaUrl = (path) => window.BULLDOGS_MEDIA?.publicMediaUrl?.(path) || path;
  const photoPool = [
    mediaUrl("events/round2-pack.jpg"),
    mediaUrl("events/round2-herning.jpg"),
    mediaUrl("events/arena-fear.jpg"),
    mediaUrl("events/team-hero.jpg"),
    mediaUrl("events/events-hero.jpg"),
  ];

  const photoFor = (event) => {
    const cover = String(event?.cover_image || "").trim();
    if (cover && (/^https?:\/\//i.test(cover) || cover.startsWith("assets/"))) return cover;
    const fallback = window.BULLDOGS_SITE_MEDIA?.home_event_fallback || photoPool[0];
    if (!event?.id) return fallback;
    let n = 0;
    for (const ch of String(event.id)) n = (n + ch.charCodeAt(0)) % photoPool.length;
    return photoPool[n] || fallback;
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

  const renderEvents = () => {
    if (!events.length) {
      listEl.innerHTML = `<p class="muted">No dates are open for booking yet. Check back soon.</p>`;
      return;
    }
    const lead = events.find((event) => event.is_bookable) || events[0];
    const rest = events.filter((event) => event !== lead);
    const more = rest.length
      ? `<h2 class="ev-more">More</h2><div class="posters">${rest.map((event) => poster(event, photoFor(event))).join("")}</div>`
      : `<p class="muted events-only">That's the only date for now.</p>`;
    listEl.innerHTML = `<h2 class="ev-more ev-next">Next</h2>${feature(lead, photoFor(lead))}${more}`;
    requestAnimationFrame(fitWhen);
  };

  const fitWhen = () => {
    listEl.querySelectorAll("[data-when]").forEach((line) => {
      line.classList.remove("is-split");
      const available = line.clientWidth;
      if (!available) return;
      const previous = line.style.whiteSpace;
      line.style.whiteSpace = "nowrap";
      const needsSplit = line.scrollWidth > available + 1;
      line.style.whiteSpace = previous;
      line.classList.toggle("is-split", needsSplit);
    });
  };

  window.addEventListener("resize", fitWhen);

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
        <textarea name="medical_notes" maxlength="2000" placeholder="Optional: anything coaches should know" aria-label="Medical notes"></textarea>
      </div>
      <label class="field field--check">
        <input type="checkbox" name="attendee_photo_consent" />
        <span>Photos and video of this attendee may be used by Team Bulldogs (optional)</span>
      </label>
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

  const multiline = (value) =>
    escapeHtml(value)
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => `<p>${line}</p>`)
      .join("");

  const openEventInfo = (event) => {
    if (!event || !infoDialog) return;
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
    if (event.summary) {
      blocks.push(`<section><h3>Summary</h3>${multiline(event.summary)}</section>`);
    }
    if (event.description) {
      blocks.push(`<section><h3>Description</h3>${multiline(event.description)}</section>`);
    }
    if (event.what_to_bring) {
      blocks.push(`<section><h3>What to bring</h3>${multiline(event.what_to_bring)}</section>`);
    }
    if (!blocks.length) {
      blocks.push(`<p class="muted">No extra details for this event yet.</p>`);
    }
    infoDialog.querySelector("[data-event-info-copy]").innerHTML = blocks.join("");
    const acts = infoDialog.querySelector("[data-event-info-acts]");
    if (event.is_bookable) {
      acts.innerHTML = `<button class="btn btn--accent" type="button" data-book="${escapeHtml(event.id)}">Book now</button>`;
    } else if (event.spaces_left === 0) {
      acts.innerHTML = `<button class="btn btn--accent" type="button" data-waitlist="${escapeHtml(event.id)}">Join waitlist</button>`;
    } else {
      acts.innerHTML = `<span class="btn btn--ghost" aria-disabled="true">Closed</span>`;
    }
    infoDialog.showModal();
  };

  const loadEvents = async () => {
    listEl.innerHTML = `<p class="muted">Loading dates…</p>`;
    events = await api.rpc("list_upcoming_events");
    renderEvents();
  };

  const onEventActionClick = (e) => {
    const info = e.target.closest("[data-event-info]");
    if (info) {
      openEventInfo(events.find((item) => item.id === info.getAttribute("data-event-info")));
      return;
    }
    const book = e.target.closest("[data-book]");
    if (book) {
      infoDialog?.close();
      openBooking(events.find((item) => item.id === book.getAttribute("data-book")));
      return;
    }
    const wait = e.target.closest("[data-waitlist]");
    if (wait) {
      infoDialog?.close();
      openWaitlist(events.find((item) => item.id === wait.getAttribute("data-waitlist")));
    }
  };

  listEl.addEventListener("click", onEventActionClick);
  infoDialog?.addEventListener("click", onEventActionClick);

  dialog?.querySelectorAll("[data-close-booking]").forEach((btn) => {
    btn.addEventListener("click", () => dialog.close());
  });

  waitDialog?.querySelectorAll("[data-close-waitlist]").forEach((btn) => {
    btn.addEventListener("click", () => waitDialog.close());
  });

  infoDialog?.querySelectorAll("[data-close-event-info]").forEach((btn) => {
    btn.addEventListener("click", () => infoDialog.close());
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
      photo_consent: block.querySelector('[name="attendee_photo_consent"]').checked,
    }));

    const hasHealthNotes = attendees.some((person) => person.medical_notes.trim());
    if (hasHealthNotes && data.get("health_consent") !== "on") {
      const box = form.querySelector('[name="health_consent"]');
      box.setCustomValidity("Agree to us storing the medical notes, or go back and leave them blank.");
      box.reportValidity();
      box.setCustomValidity("");
      return;
    }

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
        health_consent: data.get("health_consent") === "on",
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
