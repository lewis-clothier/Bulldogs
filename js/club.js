(() => {
  const api = window.BULLDOGS_API;
  const auth = window.BULLDOGS_AUTH;
  const app = document.querySelector("[data-club-app]");
  const unknown = document.querySelector("[data-club-unknown]");
  if (!api || !auth || !app) return;

  const club = (body) => api.fn("club-api", body);
  const eventsList = document.querySelector("[data-events-list]");
  const doorSelect = document.querySelector("[data-door-select]");
  const doorBody = document.querySelector("[data-door-body]");
  const stockTable = document.querySelector("[data-stock-table]");
  const stockSave = document.querySelector("[data-save-stock]");
  const stockStatus = document.querySelector("[data-stock-status]");
  const ordersList = document.querySelector("[data-orders-list]");
  const newsBody = document.querySelector("[data-news-body]");
  const adminsList = document.querySelector("[data-admins-list]");
  const eventEditor = document.querySelector("[data-event-editor]");
  const kpis = document.querySelector("[data-admin-kpis]");
  const undoBox = document.querySelector("[data-undo]");
  const eventForm = document.querySelector("[data-event-form]");
  const fld = (name) => eventForm.elements.namedItem(name);

  const escapeHtml = (value) =>
    String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");

  const whenFmt = (iso) => {
    if (!iso) return "";
    return new Intl.DateTimeFormat("en-GB", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Europe/London",
    }).format(new Date(iso));
  };

  const gbp = (pence) => {
    const n = Number(pence || 0);
    return `£${(n / 100).toFixed(n % 100 ? 2 : 0)}`;
  };

  const pad = (n) => String(n).padStart(2, "0");
  const toLocalInput = (iso) => {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  const fromLocalInput = (value) => (value ? new Date(value).toISOString() : null);

  const slugify = (value) =>
    String(value || "")
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80);

  const eventStatus = (ev) => {
    if (!ev.is_published) return { label: "Draft", kind: "draft" };
    if (ev.is_signup_open) return { label: "Live", kind: "live" };
    return { label: "Closed", kind: "closed" };
  };

  const empty = (message) => `<p class="admin-empty">${escapeHtml(message)}</p>`;
  const fail = (el, err) => {
    if (el) el.innerHTML = `<p class="form-status is-error">${escapeHtml(err.message || "Couldn't load this.")}</p>`;
  };

  const download = (text, name) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  let eventsCache = [];
  let ordersCache = [];
  let doorEventId = null;
  let doorAttendees = [];
  let scanner = null;
  let orderFilter = "paid";
  let slugLocked = false;
  let waitCounts = {};
  let undoTimer = 0;
  let undoRun = null;

  const orderPence = (order) =>
    Number(order.amount_total_pence ?? Number(order.amount_subtotal_pence || 0) + Number(order.amount_shipping_pence || 0));

  function showUndo(message, action) {
    if (!undoBox) return;
    undoBox.hidden = false;
    undoBox.querySelector("[data-undo-text]").textContent = message;
    const button = undoBox.querySelector("[data-undo-btn]");
    if (button) button.hidden = !action;
    undoRun = action || null;
    clearTimeout(undoTimer);
    undoTimer = setTimeout(() => {
      undoBox.hidden = true;
      undoRun = null;
    }, 8000);
  }

  undoBox?.querySelector("[data-undo-btn]")?.addEventListener("click", async () => {
    const run = undoRun;
    undoRun = null;
    clearTimeout(undoTimer);
    undoBox.hidden = true;
    if (!run) return;
    try {
      await run();
    } catch (err) {
      showUndo(err.message || "Couldn't undo that");
    }
  });

  const payloadFromEvent = (ev) => ({
    action: "upsert_event",
    id: ev.id,
    title: ev.title,
    slug: ev.slug,
    summary: ev.summary,
    description: ev.description,
    starts_at: ev.starts_at,
    ends_at: ev.ends_at,
    price_pence: ev.price_pence || 0,
    capacity: ev.capacity,
    location: ev.location,
    age_range: ev.age_range,
    what_to_bring: ev.what_to_bring,
    is_published: Boolean(ev.is_published),
    is_signup_open: Boolean(ev.is_signup_open),
  });

  const kpi = (label, value, note, warn) =>
    `<article class="kpi glass"><span>${escapeHtml(label)}</span><b>${escapeHtml(value)}</b>${note ? `<small class="${warn ? "warn" : ""}">${escapeHtml(note)}</small>` : ""}</article>`;

  const paintTabCounts = () => {
    const n = ordersCache.filter((order) => order.status === "paid").length;
    const badge = document.querySelector("[data-tab-count='orders']");
    if (!badge) return;
    badge.hidden = n < 1;
    badge.textContent = String(n);
  };

  async function paintKpis() {
    if (!kpis) return;
    let summary = null;
    try {
      summary = await club({ action: "summary" });
    } catch {
      summary = null;
    }
    const live =
      summary?.live_events ??
      eventsCache.filter((ev) => ev.is_published && new Date(ev.starts_at).getTime() > Date.now()).length;
    const places = summary ? summary.booked_places : null;
    const fulfil = summary?.orders_to_fulfil ?? ordersCache.filter((order) => order.status === "paid").length;
    const revenuePence = summary
      ? summary.revenue_pence
      : ordersCache.length
        ? ordersCache
            .filter((order) => order.status === "paid" || order.status === "fulfilled")
            .reduce((sum, order) => sum + orderPence(order), 0)
        : null;
    const drafts = eventsCache.filter((ev) => !ev.is_published).length;
    let oldestNote = "";
    let oldestWarn = false;
    if (fulfil > 0) {
      const times = ordersCache
        .filter((order) => order.status === "paid" && order.created_at)
        .map((order) => new Date(order.created_at).getTime())
        .filter((n) => !Number.isNaN(n));
      if (times.length) {
        const days = Math.max(0, Math.floor((Date.now() - Math.min(...times)) / 86400000));
        oldestNote = days === 0 ? "Oldest today" : `Oldest ${days} day${days === 1 ? "" : "s"}`;
        oldestWarn = days >= 4;
      }
    }
    kpis.innerHTML = [
      kpi("Live events", String(live), drafts ? `${drafts} draft${drafts === 1 ? "" : "s"}` : "On the site"),
      kpi("Booked places", places == null ? "—" : String(places), places == null ? "" : "On upcoming events"),
      kpi("Revenue", revenuePence == null ? "—" : gbp(revenuePence), revenuePence == null ? "" : "Paid and fulfilled"),
      kpi("Orders to fulfil", String(fulfil), oldestNote, oldestWarn),
    ].join("");
    paintTabCounts();
  }

  const hideAdmin = () => {
    document.title = "Team Bulldogs";
    document.body.classList.remove("is-admin");
    if (unknown) unknown.hidden = false;
    app.hidden = true;
  };

  const loadQrLib = () => {
    if (window.Html5Qrcode || document.querySelector("[data-qr-lib]")) return;
    const script = document.createElement("script");
    script.src = "https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js";
    script.async = true;
    script.dataset.qrLib = "";
    document.body.appendChild(script);
  };

  const revealAdmin = () => {
    document.title = "Admin — Team Bulldogs";
    document.body.classList.add("is-admin");
    if (unknown) unknown.hidden = true;
    app.hidden = false;
    loadQrLib();
  };

  const show = async (session) => {
    if (!session) {
      hideAdmin();
      return;
    }
    try {
      await club({ action: "whoami" });
      revealAdmin();
      loadEvents();
      loadStock();
      loadOrders();
      loadAdmins();
      loadNews();
    } catch {
      hideAdmin();
    }
  };

  auth.whenReady().then((sb) => {
    sb.auth.onAuthStateChange((_e, session) => show(session));
    sb.auth.getSession().then(({ data }) => show(data.session));
  });

  const setTab = (name) => {
    document.querySelectorAll("[data-tab]").forEach((btn) => btn.classList.toggle("is-active", btn.dataset.tab === name));
    const show = name === "stock" ? "orders" : name;
    document.querySelectorAll("[data-panel]").forEach((panel) => {
      panel.hidden = panel.getAttribute("data-panel") !== show;
    });
    const layout = document.querySelector("[data-orders-layout]");
    if (layout) layout.dataset.mode = name === "stock" ? "stock" : "both";
    if (name !== "door") stopScanner();
    if (name === "door") fillDoorSelect();
    if (name === "admins") loadAdmins();
    if (name === "news") loadNews();
  };

  document.querySelectorAll("[data-tab]").forEach((btn) => {
    btn.addEventListener("click", () => setTab(btn.dataset.tab));
  });

  document.querySelector("[data-event-admin-filters]")?.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-admin-filter]");
    if (!btn) return;
    eventFilter = btn.dataset.adminFilter;
    document.querySelectorAll("[data-admin-filter]").forEach((el) => el.classList.toggle("is-on", el === btn));
    renderEvents();
  });

  document.querySelector("[data-admin-search]")?.addEventListener("input", (event) => {
    eventQuery = event.target.value;
    renderEvents();
  });

  async function loadEvents() {
    if (!eventsList) return;
    try {
      const { events } = await club({ action: "list_events" });
      eventsCache = events || [];
      try {
        const { rows } = await club({ action: "list_waitlist" });
        waitCounts = {};
        for (const row of rows || []) waitCounts[row.event_id] = (waitCounts[row.event_id] || 0) + 1;
      } catch {
        waitCounts = {};
      }
      renderEvents();
      fillDoorSelect();
      paintKpis();
    } catch (err) {
      fail(eventsList, err);
    }
  }

  let eventFilter = "upcoming";
  let eventQuery = "";

  const eventMatches = (ev) => {
    const q = eventQuery.trim().toLowerCase();
    if (q && !`${ev.title || ""} ${ev.location || ""}`.toLowerCase().includes(q)) return false;
    if (eventFilter === "all") return true;
    if (eventFilter === "drafts") return !ev.is_published;
    const start = new Date(ev.starts_at).getTime();
    const past = !Number.isNaN(start) && start < Date.now();
    if (eventFilter === "past") return Boolean(ev.is_published) && past;
    return Boolean(ev.is_published) && !past;
  };

  function renderEvents() {
    const rows = eventsCache.filter(eventMatches);
    if (!eventsCache.length) {
      eventsList.innerHTML = empty("No events yet. Create one to put it on the site.");
      return;
    }
    if (!rows.length) {
      eventsList.innerHTML = empty("Nothing in this view.");
      return;
    }
    const editingId = eventEditor && !eventEditor.hidden ? fld("id").value : "";
    eventsList.innerHTML = `<div class="ev-rows">${rows
      .map((ev) => {
        const status = eventStatus(ev);
        const price = Number(ev.price_pence || 0) === 0 ? "Free" : gbp(ev.price_pence);
        const cap = ev.capacity == null ? "Open capacity" : `${ev.capacity} places`;
        const waiting = waitCounts[ev.id] || 0;
        const when = ev.starts_at ? new Date(ev.starts_at) : null;
        const day = when && !Number.isNaN(when.getTime()) ? pad(when.getDate()) : "—";
        const mon = when && !Number.isNaN(when.getTime()) ? when.toLocaleDateString("en-GB", { month: "short" }).toUpperCase() : "";
        const pill = status.kind === "live" ? "pill pill--live" : status.kind === "closed" ? "pill pill--hot" : "pill";
        const time = ev.starts_at ? whenFmt(ev.starts_at) : "No date yet";
        return `<article class="ev-row glass${editingId === ev.id ? " is-on" : ""}">
          <span class="tile"><b>${day}</b><span>${escapeHtml(mon)}</span></span>
          <div>
            <h4>${escapeHtml(ev.title)} <span class="${pill}">${status.label}</span></h4>
            <p>${escapeHtml(time)}${ev.location ? ` · ${escapeHtml(ev.location)}` : ""} · ${price}</p>
          </div>
          <div class="ev-row__cap">${escapeHtml(cap)}${waiting ? `<br>${waiting} waiting` : ""}</div>
          <div class="acts">
            <button class="btn btn--ghost btn--small" type="button" data-edit-event="${ev.id}">Edit</button>
            <button class="btn btn--ghost btn--small" type="button" data-door-event="${ev.id}">Door</button>
            <button class="btn btn--ghost btn--small" type="button" data-csv-event="${ev.id}" data-csv-slug="${escapeHtml(ev.slug || "attendees")}">CSV</button>
          </div>
        </article>`;
      })
      .join("")}</div>`;
  }

  const resetEventForm = () => {
    eventForm.reset();
    fld("id").value = "";
    fld("is_signup_open").checked = true;
    fld("is_published").checked = false;
    slugLocked = false;
    fld("slug").dataset.locked = "";
    eventForm.querySelector("[data-cancel-event]").hidden = true;
    eventForm.querySelector(".form-status").textContent = "";
    document.querySelector("[data-event-dialog-title]").textContent = "New event";
  };

  const fillEventForm = (ev) => {
    resetEventForm();
    slugLocked = true;
    fld("slug").dataset.locked = "1";
    fld("id").value = ev.id;
    fld("title").value = ev.title || "";
    fld("slug").value = ev.slug || "";
    fld("summary").value = ev.summary || "";
    fld("description").value = ev.description || "";
    fld("starts_at").value = toLocalInput(ev.starts_at);
    fld("ends_at").value = toLocalInput(ev.ends_at);
    fld("price_pounds").value = ((ev.price_pence || 0) / 100).toFixed(2);
    fld("capacity").value = ev.capacity ?? "";
    fld("location").value = ev.location || "";
    fld("age_range").value = ev.age_range || "";
    fld("what_to_bring").value = ev.what_to_bring || "";
    fld("is_published").checked = Boolean(ev.is_published);
    fld("is_signup_open").checked = Boolean(ev.is_signup_open);
    eventForm.querySelector("[data-cancel-event]").hidden = false;
    eventForm.querySelector("[data-cancel-event]").dataset.cancelEvent = ev.id;
    document.querySelector("[data-event-dialog-title]").textContent = "Edit event";
  };

  const saveBar = eventForm?.querySelector("[data-save-bar]");
  const formSnapshot = () => (eventForm ? JSON.stringify([...new FormData(eventForm).entries()]) : "");
  let cleanSnapshot = "";
  const syncSaveBar = () => {
    if (saveBar) saveBar.hidden = formSnapshot() === cleanSnapshot;
  };
  const markClean = () => {
    cleanSnapshot = formSnapshot();
    syncSaveBar();
  };
  eventForm?.addEventListener("input", syncSaveBar);
  eventForm?.addEventListener("change", syncSaveBar);

  const openEventDialog = () => {
    if (!eventEditor) return;
    eventEditor.hidden = false;
    renderEvents();
    markClean();
    eventEditor.scrollIntoView({ block: "nearest" });
    fld("title").focus();
  };

  const closeEventDialog = () => {
    if (!eventEditor) return;
    eventEditor.hidden = true;
    renderEvents();
  };

  app.addEventListener("click", async (event) => {
    if (event.target.closest("[data-new-event]")) {
      resetEventForm();
      openEventDialog();
      return;
    }
    const edit = event.target.closest("[data-edit-event]");
    if (edit) {
      const ev = eventsCache.find((item) => item.id === edit.dataset.editEvent);
      if (!ev) return;
      fillEventForm(ev);
      openEventDialog();
      return;
    }
    const door = event.target.closest("[data-door-event]");
    if (door) {
      setTab("door");
      doorSelect.value = door.dataset.doorEvent;
      loadDoor(door.dataset.doorEvent);
      return;
    }
    const csv = event.target.closest("[data-csv-event]");
    if (csv) {
      const { csv: text } = await club({ action: "attendees_csv", event_id: csv.dataset.csvEvent });
      download(text, `${csv.dataset.csvSlug || "attendees"}.csv`);
    }
  });

  fld("title").addEventListener("input", () => {
    if (slugLocked || fld("slug").dataset.locked) return;
    fld("slug").value = slugify(fld("title").value);
    syncSaveBar();
  });
  fld("slug").addEventListener("input", () => {
    slugLocked = Boolean(fld("slug").value);
    fld("slug").dataset.locked = slugLocked ? "1" : "";
  });

  eventForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const st = eventForm.querySelector(".form-status");
    const submit = eventForm.querySelector('button[type="submit"]');
    try {
      submit.disabled = true;
      const previous = fld("id").value ? eventsCache.find((item) => item.id === fld("id").value) : null;
      const snapshot = previous ? { ...previous } : null;
      const result = await club({
        action: "upsert_event",
        id: fld("id").value || undefined,
        title: fld("title").value,
        slug: fld("slug").value,
        summary: fld("summary").value,
        description: fld("description").value,
        starts_at: fromLocalInput(fld("starts_at").value),
        ends_at: fromLocalInput(fld("ends_at").value),
        price_pence: Math.round(Number(fld("price_pounds").value || 0) * 100),
        capacity: fld("capacity").value === "" ? null : Number(fld("capacity").value),
        location: fld("location").value,
        age_range: fld("age_range").value,
        what_to_bring: fld("what_to_bring").value,
        is_published: fld("is_published").checked,
        is_signup_open: fld("is_signup_open").checked,
      });
      if (!fld("id").value && result?.id) {
        fld("id").value = result.id;
        const cancel = eventForm.querySelector("[data-cancel-event]");
        cancel.hidden = false;
        cancel.dataset.cancelEvent = result.id;
      }
      st.textContent = "Saved.";
      st.classList.remove("is-error");
      markClean();
      if (snapshot) {
        showUndo("Event saved", async () => {
          await club(payloadFromEvent(snapshot));
          await loadEvents();
        });
      } else {
        showUndo("Event saved");
      }
      loadEvents();
    } catch (err) {
      st.textContent = err.message;
      st.classList.add("is-error");
    } finally {
      submit.disabled = false;
    }
  });

  eventForm.querySelector("[data-cancel-event]").addEventListener("click", async (event) => {
    const id = event.currentTarget.dataset.cancelEvent;
    if (!id || !confirm("Cancel this event? Paid bookings are refunded and everyone is emailed.")) return;
    try {
      await club({ action: "cancel_event", event_id: id });
      closeEventDialog();
      loadEvents();
      showUndo("Event cancelled");
    } catch (err) {
      const st = eventForm.querySelector(".form-status");
      st.textContent = err.message;
      st.classList.add("is-error");
    }
  });

  document.querySelector("[data-event-close]")?.addEventListener("click", closeEventDialog);

  function fillDoorSelect() {
    if (!doorSelect) return;
    const current = doorSelect.value || doorEventId || "";
    const options = [`<option value="">Choose an event</option>`]
      .concat(
        eventsCache.map((ev) => `<option value="${ev.id}">${escapeHtml(ev.title)} · ${escapeHtml(whenFmt(ev.starts_at))}</option>`),
      )
      .join("");
    doorSelect.innerHTML = options;
    if (current && eventsCache.some((ev) => ev.id === current)) doorSelect.value = current;
  }

  const resetDoorTools = async () => {
    await stopScanner();
    const scanBtn = doorBody.querySelector("[data-start-scan]");
    if (scanBtn) {
      scanBtn.disabled = false;
      scanBtn.textContent = "Scan ticket";
    }
    const qr = doorBody.querySelector("#club-qr");
    if (qr) {
      qr.hidden = true;
      qr.textContent = "";
    }
    const box = doorBody.querySelector("[data-scan-result]");
    if (box) {
      box.className = "";
      box.innerHTML = "";
    }
  };

  doorSelect?.addEventListener("change", async () => {
    await resetDoorTools();
    if (doorSelect.value) loadDoor(doorSelect.value);
    else {
      doorEventId = null;
      doorBody.innerHTML = empty("Choose an event to check people in.");
    }
  });

  async function stopScanner() {
    if (!scanner) return;
    try {
      await scanner.stop();
    } catch {
      /* already stopped */
    }
    scanner = null;
  }

  async function loadDoor(eventId) {
    doorEventId = eventId;
    try {
      const { attendees } = await club({ action: "list_attendees", event_id: eventId });
      doorAttendees = (attendees || []).filter((row) => row.status === "paid");
      renderDoorPeople();
    } catch (err) {
      fail(doorBody, err);
    }
  }

  const doorMatches = (query) => {
    const q = query.trim().toLowerCase();
    if (!q) return doorAttendees;
    return doorAttendees.filter(
      (row) =>
        (row.attendee_name || "").toLowerCase().includes(q) ||
        (row.email || "").toLowerCase().includes(q) ||
        (row.full_name || "").toLowerCase().includes(q),
    );
  };

  function ensureDoorShell() {
    if (doorBody.querySelector(".door")) return;
    doorBody.innerHTML = `
      <div class="door">
        <div class="scan glass">
          <div class="scan__view">
            <div id="club-qr" class="admin-qr" hidden></div>
            <p class="scan__hint">Search a name, or scan a ticket.</p>
          </div>
          <button class="btn btn--accent btn--small" type="button" data-start-scan>Scan ticket</button>
          <div data-scan-result></div>
        </div>
        <div class="panel glass">
          <div class="door__count" data-door-counts></div>
          <div class="meter"><i data-door-meter></i></div>
          <form data-search-door>
            <input name="query" type="search" placeholder="Search by name or email" aria-label="Search attendees" />
          </form>
          <div class="people" data-door-people></div>
        </div>
      </div>`;
  }

  function renderDoorPeople() {
    ensureDoorShell();
    const query = doorBody.querySelector("[name=query]")?.value || "";
    const people = doorMatches(query);
    const waiting = people.filter((p) => !p.checked_in_at).length;
    const inCount = people.filter((p) => p.checked_in_at).length;
    const counts = doorBody.querySelector("[data-door-counts]");
    const list = doorBody.querySelector("[data-door-people]");
    const meter = doorBody.querySelector("[data-door-meter]");
    if (counts) {
      counts.innerHTML = `
        <div><b>${inCount}</b><span>In</span></div>
        <div><b>${waiting}</b><span>Waiting</span></div>
        <div><b>${people.length}</b><span>Shown</span></div>`;
    }
    if (meter) meter.style.width = `${people.length ? Math.round((inCount / people.length) * 100) : 0}%`;
    if (!list) return;
    const initials = (name) =>
      String(name || "")
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0])
        .join("")
        .toUpperCase();
    list.innerHTML = people.length
      ? people
          .map((p) => {
            const inDoor = Boolean(p.checked_in_at);
            const note = p.medical_notes
              ? p.medical_notes.length > 28
                ? `${p.medical_notes.slice(0, 28)}…`
                : p.medical_notes
              : "";
            const whenIn = p.checked_in_at
              ? new Date(p.checked_in_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
              : "";
            const action = inDoor
              ? `<span class="tick">✓ ${escapeHtml(whenIn)}</span>`
              : `<button class="btn btn--accent btn--small" type="button" data-manual-check="${escapeHtml(p.checkin_token || "")}">Check in</button>`;
            const meta = [p.attendee_date_of_birth && `DOB ${p.attendee_date_of_birth}`, p.email].filter(Boolean).join(" · ");
            return `<article class="person${inDoor ? " in" : ""}">
              <span class="av">${escapeHtml(initials(p.attendee_name) || "·")}</span>
              <div>
                <b>${escapeHtml(p.attendee_name)}</b>
                <small>${escapeHtml(meta)}</small>
              </div>
              ${note ? `<span class="flag">${escapeHtml(note)}</span>` : "<span></span>"}
              ${action}
            </article>`;
          })
          .join("")
      : empty("No paid attendees match.");
  }

  let scanning = false;
  const paintScan = (cls, html) => {
    const box = doorBody.querySelector("[data-scan-result]");
    if (!box) return;
    box.className = cls;
    box.innerHTML = html;
  };

  async function onScan(text) {
    if (scanning) return;
    scanning = true;
    let token = text;
    try {
      const url = new URL(text);
      const hash = new URLSearchParams(url.hash.replace(/^#/, ""));
      token = url.searchParams.get("t") || hash.get("t") || url.searchParams.get("c") || hash.get("c") || text;
    } catch {
      /* raw token */
    }
    try {
      const result = await club({ action: "checkin", token, event_id: doorEventId });
      const person = result.attendee;
      paintScan(
        result.already ? "admin-result admin-result--warn" : "admin-result admin-result--ok",
        `<h3>${escapeHtml(person.attendee_name)}</h3>
          <p>${result.already ? "Already checked in" : "Checked in"}</p>
          <p class="muted">DOB ${escapeHtml(person.attendee_date_of_birth || "—")}</p>
          <p>${person.medical_notes ? `<strong>Medical:</strong> ${escapeHtml(person.medical_notes)}` : "No medical notes"}</p>
          <p class="muted">Emergency: ${escapeHtml(person.emergency_contact_name || "—")} ${escapeHtml(person.emergency_contact_phone || "")}</p>`,
      );
      await loadDoor(doorEventId);
      if (!result.already && person?.id) {
        showUndo(`${person.attendee_name || "Attendee"} checked in`, async () => {
          await club({ action: "undo_checkin", registration_id: person.id });
          if (doorEventId) await loadDoor(doorEventId);
        });
      }
    } catch (err) {
      paintScan("admin-result admin-result--err", escapeHtml(err.message));
    } finally {
      scanning = false;
    }
  }

  doorBody.addEventListener("input", (event) => {
    const form = event.target.closest("[data-search-door]");
    if (!form) return;
    renderDoorPeople();
  });

  doorBody.addEventListener("submit", (event) => {
    if (!event.target.closest("[data-search-door]")) return;
    event.preventDefault();
  });

  doorBody.addEventListener("click", async (event) => {
    const start = event.target.closest("[data-start-scan]");
    const manual = event.target.closest("[data-manual-check]");
    if (start) {
      const host = doorBody.querySelector("#club-qr");
      if (!host) return;
      host.hidden = false;
      if (!window.Html5Qrcode) {
        host.textContent = "Camera scanner couldn’t load — use search instead.";
        return;
      }
      await stopScanner();
      scanner = new window.Html5Qrcode("club-qr");
      scanner.start({ facingMode: "environment" }, { fps: 8, qrbox: 180 }, onScan).catch(() => {
        host.textContent = "Camera unavailable — search by name instead.";
      });
      start.textContent = "Scanning…";
      start.disabled = true;
    }
    if (manual) await onScan(manual.dataset.manualCheck);
  });

  async function loadStock() {
    if (!stockTable) return;
    try {
      const { variants } = await club({ action: "list_stock" });
      const rows = variants || [];
      if (!rows.length) {
        stockTable.innerHTML = empty("No product variants yet.");
        setStockDirty(false);
        return;
      }
      stockTable.innerHTML = `<table class="stock">
        <thead><tr><th>Variant</th><th>Sold</th><th>On hand</th></tr></thead>
        <tbody>${rows
          .map((v) => {
            const colour = String(v.colour || "");
            const dot = colour.toLowerCase() === "blue" ? "var(--sky)" : "var(--orange)";
            const low = `<span class="low"${Number(v.on_hand) > 2 ? " hidden" : ""}>Low</span>`;
            const held = Number(v.reserved) > 0 ? `<small class="muted">${v.reserved} reserved</small>` : "";
            return `<tr>
              <td><span class="dot" style="--dot: ${dot}"></span>${escapeHtml(colour)} · ${escapeHtml(v.size)}${low}${held ? `<br>${held}` : ""}</td>
              <td class="muted">${v.sold}</td>
              <td><span class="step"><button type="button" data-step="-1" aria-label="Decrease ${escapeHtml(colour)} ${escapeHtml(v.size)}">−</button><input data-onhand data-product="${escapeHtml(v.product_id)}" data-colour="${escapeHtml(v.colour)}" data-size="${escapeHtml(v.size)}" data-original="${v.on_hand}" data-reserved="${v.reserved}" data-sold="${v.sold}" type="number" min="0" value="${v.on_hand}" aria-label="On hand" /><button type="button" data-step="1" aria-label="Increase ${escapeHtml(colour)} ${escapeHtml(v.size)}">+</button></span></td>
            </tr>`;
          })
          .join("")}</tbody></table>`;
      setStockDirty(false);
      if (stockStatus) stockStatus.textContent = "";
    } catch (err) {
      fail(stockTable, err);
    }
  }

  const stockBar = document.querySelector("[data-stock-bar]");
  const stockDirty = () =>
    [...(stockTable?.querySelectorAll("[data-onhand]") || [])].some((input) => input.value !== input.dataset.original);
  const setStockDirty = (dirty) => {
    const host = stockBar || stockSave;
    if (host) host.hidden = !dirty;
    const text = document.querySelector("[data-stock-bar-text]");
    if (text && dirty && stockTable) {
      const n = [...stockTable.querySelectorAll("[data-onhand]")].filter((input) => input.value !== input.dataset.original).length;
      text.textContent = n === 1 ? "1 size changed" : `${n} sizes changed`;
    }
  };

  stockTable?.addEventListener("input", (event) => {
    const input = event.target.closest("[data-onhand]");
    if (!input) return;
    input.closest(".step")?.classList.toggle("is-dirty", input.value !== input.dataset.original);
    const low = input.closest("tr")?.querySelector(".low");
    if (low) low.hidden = Number(input.value || 0) > 2;
    setStockDirty(stockDirty());
  });

  stockTable?.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-step]");
    if (!btn) return;
    const input = btn.parentElement?.querySelector("[data-onhand]");
    if (!input) return;
    input.value = String(Math.max(0, Number(input.value || 0) + Number(btn.dataset.step)));
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });

  stockSave?.addEventListener("click", async () => {
    if ((stockBar || stockSave).hidden) return;
    const changes = [...stockTable.querySelectorAll("[data-onhand]")]
      .filter((input) => input.value !== input.dataset.original)
      .map((input) => ({
        product_id: input.dataset.product,
        colour: input.dataset.colour,
        size: input.dataset.size,
        previous: Number(input.dataset.original),
      }));
    try {
      stockSave.disabled = true;
      for (const input of stockTable.querySelectorAll("[data-onhand]")) {
        if (input.value === input.dataset.original) continue;
        await club({
          action: "set_on_hand",
          product_id: input.dataset.product,
          colour: input.dataset.colour,
          size: input.dataset.size,
          on_hand: Number(input.value),
        });
      }
      if (stockStatus) {
        stockStatus.textContent = "Saved.";
        stockStatus.classList.remove("is-error");
      }
      await loadStock();
      if (changes.length) {
        showUndo("Stock saved", async () => {
          for (const row of changes) {
            await club({
              action: "set_on_hand",
              product_id: row.product_id,
              colour: row.colour,
              size: row.size,
              on_hand: row.previous,
            });
          }
          await loadStock();
        });
      }
    } catch (err) {
      if (stockStatus) {
        stockStatus.textContent = err.message;
        stockStatus.classList.add("is-error");
      }
    } finally {
      stockSave.disabled = false;
    }
  });

  async function loadOrders() {
    if (!ordersList) return;
    try {
      const { orders } = await club({ action: "list_orders" });
      ordersCache = orders || [];
      renderOrders();
      paintKpis();
    } catch (err) {
      fail(ordersList, err);
    }
  }

  const paintOrderFilters = () => {
    const counts = { paid: 0, fulfilled: 0, refunded: 0, all: ordersCache.length };
    for (const order of ordersCache) {
      if (counts[order.status] != null) counts[order.status] += 1;
    }
    const labels = { paid: "To fulfil", fulfilled: "Fulfilled", refunded: "Refunded", all: "All" };
    document.querySelectorAll("[data-order-filter]").forEach((btn) => {
      const key = btn.dataset.orderFilter;
      btn.textContent = `${labels[key] || key} · ${counts[key] ?? 0}`;
    });
  };

  function renderOrders() {
    paintOrderFilters();
    const rows = orderFilter === "all" ? ordersCache : ordersCache.filter((o) => o.status === orderFilter);
    if (!rows.length) {
      ordersList.innerHTML = empty(orderFilter === "all" ? "No orders yet." : "Nothing in this view.");
      return;
    }
    ordersList.innerHTML = rows
      .map((o) => {
        const items = (o.items || [])
          .map((i) => `${escapeHtml(i.product_name)} — ${escapeHtml(i.colour || "")} · ${escapeHtml(i.size || "")} ×${i.quantity}`)
          .join(", ");
        const addr = o.shipping_address
          ? [o.shipping_address.line1, o.shipping_address.city, o.shipping_address.postal_code].filter(Boolean).join(", ")
          : "";
        const who = o.customer_name || o.customer_email || "Order";
        const pill =
          o.status === "paid" ? `<span class="pill pill--sky">Paid</span>` : `<span class="pill">${escapeHtml(o.status)}</span>`;
        const actions =
          o.status === "paid"
            ? `<div class="acts">
                <input placeholder="Tracking or note (optional)" data-note="${o.id}" />
                <button class="btn btn--accent btn--small" type="button" data-fulfil="${o.id}">Mark fulfilled</button>
                <button class="btn btn--ghost btn--small" type="button" data-refund="${o.id}">Refund</button>
              </div>`
            : "";
        return `<article class="order">
          <div>
            <h4>#${escapeHtml((o.id || "").slice(0, 8).toUpperCase())} <small>${escapeHtml(who)} · ${escapeHtml(whenFmt(o.created_at))}</small> ${pill}</h4>
            <p>${items || escapeHtml(o.customer_email || "")}</p>
            ${addr ? `<p>${escapeHtml(addr)}</p>` : ""}
          </div>
          <strong>${gbp(orderPence(o))}</strong>
          ${actions}
        </article>`;
      })
      .join("");
  }

  document.querySelector("[data-order-filters]")?.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-order-filter]");
    if (!btn) return;
    orderFilter = btn.dataset.orderFilter;
    document.querySelectorAll("[data-order-filter]").forEach((el) => {
      el.classList.toggle("is-active", el === btn);
      el.classList.toggle("is-on", el === btn);
    });
    renderOrders();
  });

  ordersList?.addEventListener("click", async (event) => {
    const fulfil = event.target.closest("[data-fulfil]");
    const refund = event.target.closest("[data-refund]");
    try {
      if (fulfil) {
        const notes = ordersList.querySelector(`[data-note="${fulfil.dataset.fulfil}"]`)?.value;
        await club({ action: "fulfil_order", order_id: fulfil.dataset.fulfil, fulfilment_notes: notes });
        await loadOrders();
        await loadStock();
        showUndo("Order marked fulfilled");
      }
      if (refund) {
        if (!confirm("Refund this order? Only do this if it hasn’t gone to print.")) return;
        await club({ action: "refund_order", order_id: refund.dataset.refund });
        await loadOrders();
        await loadStock();
        showUndo("Order refunded");
      }
    } catch (err) {
      alert(err.message);
    }
  });

  async function loadNews() {
    if (!newsBody) return;
    try {
      const { csv } = await club({ action: "newsletter_csv" });
      const lines = String(csv || "")
        .trim()
        .split("\n")
        .filter(Boolean);
      const count = Math.max(0, lines.length - 1);
      newsBody.innerHTML = `<p>${count ? `${count} subscriber${count === 1 ? "" : "s"} opted in.` : "No subscribers yet."}</p>
        <p class="muted">Download to send from your own mailing tool. People opt in at checkout.</p>`;
      newsBody.dataset.csv = csv;
    } catch (err) {
      fail(newsBody, err);
    }
  }

  document.querySelector("[data-news-csv]")?.addEventListener("click", async () => {
    if (newsBody?.dataset.csv) {
      download(newsBody.dataset.csv, "newsletter.csv");
      return;
    }
    const { csv } = await club({ action: "newsletter_csv" });
    download(csv, "newsletter.csv");
  });

  async function loadAdmins() {
    if (!adminsList) return;
    try {
      const { admins } = await club({ action: "list_admins" });
      if (!admins?.length) {
        adminsList.innerHTML = empty("No admins yet.");
        return;
      }
      adminsList.innerHTML = `<div class="admin-cards">${admins
        .map(
          (row) => `<article class="admin-card admin-card--row">
            <div>
              <h3>${escapeHtml(row.email)}</h3>
              <p class="muted">${row.user_id ? "Has an account" : "Applies when they sign in"}</p>
            </div>
            <button class="btn btn--ghost btn--small" type="button" data-revoke-admin="${escapeHtml(row.email)}">Remove</button>
          </article>`,
        )
        .join("")}</div>`;
    } catch (err) {
      fail(adminsList, err);
    }
  }

  document.querySelector("[data-grant-admin]")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const st = form.querySelector(".form-status");
    try {
      await club({ action: "grant_admin", email: form.email.value });
      st.textContent = "Access given. They’ll see Admin tools after they sign in.";
      st.classList.remove("is-error");
      form.reset();
      loadAdmins();
    } catch (err) {
      st.textContent = err.message;
      st.classList.add("is-error");
    }
  });

  adminsList?.addEventListener("click", async (event) => {
    const btn = event.target.closest("[data-revoke-admin]");
    if (!btn || !confirm(`Remove access for ${btn.dataset.revokeAdmin}?`)) return;
    try {
      await club({ action: "revoke_admin", email: btn.dataset.revokeAdmin });
      loadAdmins();
    } catch (err) {
      alert(err.message);
    }
  });
})();
