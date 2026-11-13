(() => {
  const api = window.BULLDOGS_API;
  const auth = window.BULLDOGS_AUTH;
  const app = document.querySelector("[data-club-app]");
  const unknown = document.querySelector("[data-club-unknown]");
  if (!api || !auth || !app) return;

  const club = (body) => api.fn("club-api", body);
  const eventsList = document.querySelector("[data-events-list]");
  const scanDialog = document.querySelector("[data-scan-dialog]");
  const stockTable = document.querySelector("[data-stock-table]");
  const stockSave = document.querySelector("[data-save-stock]");
  const stockStatus = document.querySelector("[data-stock-status]");
  const ordersList = document.querySelector("[data-orders-list]");
  const orderSummary = document.querySelector("[data-order-summary]");
  const orderSummaryPanel = document.querySelector("[data-order-summary-panel]");
  const orderDialog = document.querySelector("[data-order-dialog]");
  const orderBody = document.querySelector("[data-order-body]");
  const openSummaryKeys = new Set();
  const openStockKeys = new Set();
  const stockHold = (n) => (Number(n) > 0 ? String(n) : "—");
  const newsBody = document.querySelector("[data-news-body]");
  const adminsList = document.querySelector("[data-admins-list]");
  const eventEditor = document.querySelector("[data-event-editor]");
  const kpis = document.querySelector("[data-admin-kpis]");
  const undoBox = document.querySelector("[data-undo]");
  const eventForm = document.querySelector("[data-event-form]");
  const fld = (name) => eventForm.elements.namedItem(name);

  const productImage = (colour, productId = "", productName = "") => {
    const id = String(productId || "");
    const name = String(productName || "").toLowerCase();
    const tone = String(colour || "").toLowerCase();
    if (id === "bulldogs-tee" || name.includes("tee") || !id) {
      if (tone === "blue") return "assets/products/product_1_blue_front_cutout.png";
      if (tone === "orange") return "assets/products/product_1_orange_front_cutout.png";
    }
    if (tone === "blue") return "assets/products/product_1_blue_front_cutout.png";
    if (tone === "orange") return "assets/products/product_1_orange_front_cutout.png";
    return "assets/products/product_1_orange_front_cutout.png";
  };

  const colourLabel = (colour) => {
    const value = String(colour || "").trim();
    if (!value) return "Print";
    return `${value.charAt(0).toUpperCase()}${value.slice(1)} print`;
  };

  const formatAddress = (addr) => {
    if (!addr || typeof addr !== "object") return "";
    return [addr.line1, addr.line2, addr.city, addr.state, addr.postal_code, addr.country].filter(Boolean).join(", ");
  };

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

  const CHECKIN_KEY = "bulldogs-checkins";
  const checkinOpen = new Set();
  try {
    const saved = JSON.parse(localStorage.getItem(CHECKIN_KEY) || "[]");
    if (Array.isArray(saved)) saved.forEach((id) => checkinOpen.add(String(id)));
  } catch {
    /* this browser is keeping check-ins for the session only */
  }
  const saveCheckins = () => {
    try {
      localStorage.setItem(CHECKIN_KEY, JSON.stringify([...checkinOpen]));
    } catch {
      /* ignore */
    }
  };

  const isCancelled = (ev) => Boolean(ev.cancelled_at);

  const eventStatus = (ev) => {
    if (isCancelled(ev)) return { label: "Cancelled", kind: "cancelled" };
    if (!ev.is_published) return { label: "Draft", kind: "draft" };
    if (checkinOpen.has(ev.id)) return { label: "Live", kind: "live" };
    return { label: "Published", kind: "published" };
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
  let attendanceCache = {};
  let bookingQuery = {};
  let scanner = null;
  let scanEventId = null;
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

  const eventPhotos = window.BULLDOGS?.eventPhotos || [];
  const defaultCover = eventPhotos[0]?.src || "";
  const coverAllowed = new Set(eventPhotos.map((photo) => photo.src));
  const coverFor = (ev) => {
    if (ev?.cover_image && coverAllowed.has(ev.cover_image)) return ev.cover_image;
    if (!ev?.id || !eventPhotos.length) return defaultCover;
    let n = 0;
    for (const ch of String(ev.id)) n = (n + ch.charCodeAt(0)) % eventPhotos.length;
    return eventPhotos[n].src;
  };

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
    cover_image: coverFor(ev) || null,
    is_published: Boolean(ev.is_published),
    is_signup_open: Boolean(ev.is_signup_open),
  });

  const kpi = (label, value, note, warn, tab) =>
    `<button type="button" class="kpi glass" data-kpi="${tab}"><span>${escapeHtml(label)}</span><b>${escapeHtml(value)}</b>${note ? `<small class="${warn ? "warn" : ""}">${escapeHtml(note)}</small>` : ""}</button>`;

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
    const drafts = eventsCache.filter((ev) => !ev.is_published && !isCancelled(ev)).length;
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
      kpi("Live events", String(live), drafts ? `${drafts} draft${drafts === 1 ? "" : "s"}` : "On the site", false, "events"),
      kpi("Booked places", places == null ? "—" : String(places), places == null ? "" : "On upcoming events", false, "events"),
      kpi("Revenue", revenuePence == null ? "—" : gbp(revenuePence), revenuePence == null ? "" : "Paid and fulfilled", false, "orders"),
      kpi("Orders to fulfil", String(fulfil), oldestNote, oldestWarn, "orders"),
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
      setTab(location.hash.slice(1) || "events");
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

  const tabs = ["events", "orders", "stock", "news", "admins"];

  const setTab = (name) => {
    if (name === "door") name = "events";
    if (!tabs.includes(name)) name = "events";
    document.querySelectorAll("[data-tab]").forEach((btn) => btn.classList.toggle("is-active", btn.dataset.tab === name));
    document.querySelectorAll("[data-panel]").forEach((panel) => {
      panel.hidden = panel.getAttribute("data-panel") !== name;
    });
    if (location.hash !== `#${name}`) history.replaceState(null, "", `#${name}`);
    if (name !== "events") {
      if (eventEditor?.open) eventEditor.close();
      void stopScanner();
    }
    if (name === "admins") loadAdmins();
    if (name === "news") loadNews();
  };

  kpis?.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-kpi]");
    if (btn) setTab(btn.dataset.kpi);
  });

  document.querySelectorAll("[data-tab]").forEach((btn) => {
    btn.addEventListener("click", () => setTab(btn.dataset.tab));
  });

  document.querySelector("[data-event-admin-filters]")?.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-admin-filter]");
    if (!btn) return;
    eventFilter = btn.dataset.adminFilter;
    soleClosed = "";
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
      await Promise.all(
        eventsCache.map(async (ev) => {
          try {
            await refreshAttendance(ev.id);
          } catch {
            if (!(ev.id in attendanceCache)) attendanceCache[ev.id] = null;
          }
        }),
      );
      renderEvents();
      paintKpis();
    } catch (err) {
      fail(eventsList, err);
    }
  }

  let eventFilter = "today";
  let eventQuery = "";
  let soleClosed = "";

  const dayBounds = () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    return { today: today.getTime(), tomorrow: tomorrow.getTime() };
  };

  const eventSpan = (ev) => {
    const start = new Date(ev.starts_at).getTime();
    if (Number.isNaN(start)) return null;
    const endRaw = ev.ends_at ? new Date(ev.ends_at).getTime() : start;
    return { start, end: Number.isNaN(endRaw) ? start : endRaw };
  };

  const eventOnToday = (ev) => {
    const span = eventSpan(ev);
    if (!span) return false;
    const { today, tomorrow } = dayBounds();
    return span.start < tomorrow && span.end >= today;
  };

  const eventMatches = (ev) => {
    const q = eventQuery.trim().toLowerCase();
    if (q && !`${ev.title || ""} ${ev.location || ""}`.toLowerCase().includes(q)) return false;
    if (eventFilter === "all") return true;
    if (eventFilter === "cancelled") return isCancelled(ev);
    if (isCancelled(ev)) return false;
    if (eventFilter === "drafts") return !ev.is_published;
    if (!ev.is_published) return false;
    const span = eventSpan(ev);
    if (!span) return eventFilter === "upcoming";
    const { today, tomorrow } = dayBounds();
    if (eventFilter === "today") return eventOnToday(ev);
    if (eventFilter === "past") return span.end < today;
    return span.start >= tomorrow;
  };

  const heldPlace = (row) => row.status === "pending" && row.expires_at && new Date(row.expires_at).getTime() > Date.now();

  const placeCounts = (ev) => {
    const rows = attendanceCache[ev.id];
    if (!rows) return null;
    const paid = rows.filter((row) => row.status === "paid");
    const held = rows.filter(heldPlace);
    const cap = ev.capacity == null || ev.capacity === "" ? null : Number(ev.capacity);
    return {
      paid,
      held: held.length,
      taken: paid.length + held.length,
      checked: paid.filter((row) => row.checked_in_at).length,
      left: cap == null || Number.isNaN(cap) ? null : Math.max(0, cap - paid.length - held.length),
    };
  };

  const barWidths = (places) => {
    const capacity = places.left == null ? null : places.left + places.taken;
    const booked = places.paid.length;
    const checked = places.checked;
    if (capacity) {
      return {
        capacity,
        booked,
        checked,
        bookedPct: Math.min(100, Math.round((places.taken / capacity) * 100)),
        inPct: Math.min(100, Math.round((checked / capacity) * 100)),
      };
    }
    return {
      capacity: null,
      booked,
      checked,
      bookedPct: booked ? 100 : 0,
      inPct: booked ? Math.min(100, Math.round((checked / booked) * 100)) : 0,
    };
  };

  const seatTrack = (places) => {
    const bar = barWidths(places);
    return `<i style="--booked: ${bar.bookedPct}%; --in: ${bar.inPct}%" aria-hidden="true"><span></span><span></span></i>`;
  };

  function spacesHtml(ev) {
    const places = placeCounts(ev);
    const waiting = waitCounts[ev.id] || 0;
    if (!places) return `<b>Places unavailable</b>`;
    const bar = barWidths(places);
    const spaces = bar.capacity == null ? "Open" : String(bar.capacity);
    const spaceWord = bar.capacity === 1 ? "space" : "spaces";
    return `<div class="seat-bar">
      <p>
        <span><b>${escapeHtml(spaces)}</b> ${spaceWord}</span>
        <span><b>${bar.booked}</b> booked</span>
        <span><b>${bar.checked}</b> checked in</span>
      </p>
      ${seatTrack(places)}
      ${places.held ? `<span class="seat-bar__note">${places.held} unpaid</span>` : ""}
      ${waiting ? `<span class="seat-bar__note">${waiting} on the waitlist</span>` : ""}
    </div>`;
  }

  function renderEvents() {
    const openId = eventsList?.querySelector("details[open]")?.dataset.eventItem || "";
    const liveQuery = eventsList?.querySelector("details[open] [name=query]");
    if (openId && liveQuery) bookingQuery[openId] = liveQuery.value;
    void stopScanner();
    const startTime = (ev) => {
      const n = new Date(ev.starts_at).getTime();
      return Number.isNaN(n) ? null : n;
    };
    const rows = eventsCache.filter(eventMatches).sort((a, b) => {
      const aStart = startTime(a);
      const bStart = startTime(b);
      if (aStart == null && bStart == null) return 0;
      if (aStart == null) return 1;
      if (bStart == null) return -1;
      if (eventFilter === "upcoming" || eventFilter === "today" || eventFilter === "all") return aStart - bStart;
      if (eventFilter === "past") return bStart - aStart;
      return 0;
    });
    if (!eventsCache.length) {
      eventsList.innerHTML = empty("No events yet. Create one to put it on the site.");
      return;
    }
    if (!rows.length) {
      const note = {
        today: "Nothing on today.",
        upcoming: "Nothing coming up.",
        past: "Nothing in the past.",
        drafts: "No drafts.",
        cancelled: "No cancelled events.",
      };
      eventsList.innerHTML = empty(note[eventFilter] || "Nothing in this view.");
      return;
    }
    const editingId = eventEditor?.open ? fld("id").value : "";
    const soleId = rows.length === 1 ? rows[0].id : "";
    const keptOpen = openId && rows.some((ev) => ev.id === openId) ? openId : "";
    const shownOpen = keptOpen || (eventFilter === "today" && soleId && soleId !== soleClosed ? soleId : "");
    eventsList.innerHTML = `<div class="ev-rows">${rows
      .map((ev) => {
        const status = eventStatus(ev);
        const price = Number(ev.price_pence || 0) === 0 ? "Free" : gbp(ev.price_pence);
        const when = ev.starts_at ? new Date(ev.starts_at) : null;
        const day = when && !Number.isNaN(when.getTime()) ? pad(when.getDate()) : "—";
        const mon = when && !Number.isNaN(when.getTime()) ? when.toLocaleDateString("en-GB", { month: "short" }).toUpperCase() : "";
        const pill =
          status.kind === "live"
            ? "pill pill--live"
            : status.kind === "published"
              ? "pill pill--sky"
              : status.kind === "cancelled"
                ? "pill pill--cancelled"
                : "pill";
        const time = ev.starts_at ? whenFmt(ev.starts_at) : "No date yet";
        const open = shownOpen === ev.id ? " open" : "";
        return `<details class="ev-item glass${editingId === ev.id ? " is-on" : ""}" data-event-item="${ev.id}" name="club-event"${open}>
          <summary class="ev-row">
            <span class="tile"><b>${day}</b><span>${escapeHtml(mon)}</span></span>
            <div>
              <h4>${escapeHtml(ev.title)} <span class="ev-status"><span class="${pill}">${status.label}</span><button class="ev-edit" type="button" data-edit-event="${ev.id}" aria-label="Edit ${escapeHtml(ev.title)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/></svg></button></span></h4>
              <p>${escapeHtml(time)}${ev.location ? ` · ${escapeHtml(ev.location)}` : ""} · ${price}</p>
            </div>
            <div class="ev-row__cap" data-event-cap="${ev.id}">${spacesHtml(ev)}</div>
            <span class="ev-chevron" aria-hidden="true"></span>
          </summary>
          <div class="ev-bookings" data-event-bookings="${ev.id}"></div>
        </details>`;
      })
      .join("")}</div>`;
    if (shownOpen && eventsList.querySelector(`details[open][data-event-item="${shownOpen}"]`)) openEvent(shownOpen);
  }

  const coverPicks = eventForm?.querySelector("[data-cover-picks]");
  const coverView = eventForm?.querySelector("[data-cover-view]");
  let coverMode = "poster";
  const paintCoverPicks = (selected) => {
    if (!coverPicks) return;
    const current = selected && coverAllowed.has(selected) ? selected : defaultCover;
    if (fld("cover_image")) fld("cover_image").value = current;
    coverPicks.innerHTML = eventPhotos
      .map(
        (photo) =>
          `<button class="cover-pick${photo.src === current ? " is-on" : ""}" type="button" data-cover-src="${escapeHtml(photo.src)}" aria-pressed="${photo.src === current ? "true" : "false"}" aria-label="${escapeHtml(photo.label)}"><img src="${escapeHtml(photo.src)}" alt="" /><span>${escapeHtml(photo.label)}</span></button>`,
      )
      .join("");
  };

  const coverClock = `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 8v5l3 2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
  const coverPin = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s6-5.2 6-10a6 6 0 1 0-12 0c0 4.8 6 10 6 10z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="11" r="2.2" fill="none" stroke="currentColor" stroke-width="2"/></svg>`;
  const coverPerson = `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="3.2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M5.5 19.5c1.2-3.2 3.5-4.8 6.5-4.8s5.3 1.6 6.5 4.8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;

  const paintCoverPreview = () => {
    const preview = eventForm?.querySelector("[data-cover-preview]");
    if (!preview) return;
    const src = fld("cover_image")?.value || defaultCover;
    const title = fld("title")?.value.trim() || "New event";
    const summary = fld("summary")?.value.trim() || "";
    const location = fld("location")?.value.trim() || "TBC";
    const age = fld("age_range")?.value.trim() || "";
    const who = age ? (/^ages\b/i.test(age) ? age : `Ages ${age}`) : "All ages";
    const pricePence = Math.round(Number(fld("price_pounds")?.value || 0) * 100);
    const price = pricePence ? gbp(pricePence) : "Free";
    const capacityRaw = fld("capacity")?.value;
    const capacity = capacityRaw === "" || capacityRaw == null ? null : Number(capacityRaw);
    const start = fld("starts_at")?.value ? new Date(fld("starts_at").value) : null;
    const end = fld("ends_at")?.value ? new Date(fld("ends_at").value) : null;
    const validStart = start && !Number.isNaN(start.getTime());
    const validEnd = end && !Number.isNaN(end.getTime());
    const day = validStart ? pad(start.getDate()) : "—";
    const mon = validStart ? start.toLocaleDateString("en-GB", { month: "short" }).toUpperCase() : "";
    const timeOnly = (d) =>
      d.toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit", hour12: false });
    const clockTime = validStart
      ? validEnd
        ? `${timeOnly(start)} – ${timeOnly(end)}`
        : timeOnly(start)
      : "Set a start time";
    const whenLong = validStart
      ? start.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })
      : "Set a date";
    const metaBits = [
      location !== "TBC" ? escapeHtml(location) : "",
      validStart ? escapeHtml(timeOnly(start)) : "",
      age ? `<span class="nowrap">${escapeHtml(who)}</span>` : "",
    ].filter(Boolean);
    const meta = metaBits.length ? metaBits.join(" · ") : "Add a date and location to fill this in.";
    const bar =
      capacity == null || Number.isNaN(capacity)
        ? `<div class="bar">Places available<i style="--bar: 0%"></i></div>`
        : `<div class="bar" style="--bar: 0%">0 of ${escapeHtml(String(capacity))} booked<i></i></div>`;
    const dateBadge = `<div class="date"><b>${escapeHtml(day)}</b><span>${escapeHtml(mon)}</span></div>`;
    if (coverMode === "feature") {
      preview.innerHTML = `<article class="ev-feature glass">
        <figure>
          <img src="${escapeHtml(src)}" alt="" />
          ${dateBadge}
        </figure>
        <div class="ev-feature__body">
          <span class="live">Next up</span>
          <h2>${escapeHtml(title)}</h2>
          ${summary ? `<p class="muted">${escapeHtml(summary)}</p>` : ""}
          <div class="ev-facts">
            <div><b>${coverPin}Where</b><p>${escapeHtml(location)}</p></div>
            <div><b>${coverClock}When</b><p>${escapeHtml(whenLong)} · ${escapeHtml(clockTime)}</p></div>
            <div><b>${coverPerson}Who</b><p>${escapeHtml(who)}</p></div>
          </div>
          ${bar}
          <div class="ev-feature__foot">
            <strong>${escapeHtml(price)}</strong>
            <span class="btn btn--accent" aria-hidden="true">Book now</span>
          </div>
        </div>
      </article>`;
      return;
    }
    preview.innerHTML = `<article class="poster">
      <figure>
        <img src="${escapeHtml(src)}" alt="" />
        ${dateBadge}
      </figure>
      <div class="poster__body">
        <h3>${escapeHtml(title)}</h3>
        <p class="muted">${meta}</p>
        ${bar}
        <div class="poster__foot"><strong>${escapeHtml(price)}</strong><span class="btn btn--accent btn--small" aria-hidden="true">Book</span></div>
      </div>
    </article>`;
  };

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
    paintCoverPicks(defaultCover);
    paintCoverPreview();
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
    paintCoverPicks(coverFor(ev));
    paintCoverPreview();
    const cancel = eventForm.querySelector("[data-cancel-event]");
    cancel.hidden = isCancelled(ev);
    cancel.dataset.cancelEvent = ev.id;
    document.querySelector("[data-event-dialog-title]").textContent = isCancelled(ev) ? "Cancelled event" : "Edit event";
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
  eventForm?.addEventListener("input", () => {
    paintCoverPreview();
    syncSaveBar();
  });
  eventForm?.addEventListener("change", () => {
    paintCoverPreview();
    syncSaveBar();
  });
  coverPicks?.addEventListener("click", (event) => {
    const pick = event.target.closest("[data-cover-src]");
    if (!pick) return;
    paintCoverPicks(pick.dataset.coverSrc);
    paintCoverPreview();
    syncSaveBar();
  });
  coverView?.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-cover-mode]");
    if (!btn) return;
    coverMode = btn.dataset.coverMode === "feature" ? "feature" : "poster";
    coverView.querySelectorAll("[data-cover-mode]").forEach((el) => el.classList.toggle("is-on", el === btn));
    paintCoverPreview();
  });

  const openEventDialog = () => {
    if (!eventEditor) return;
    if (!eventEditor.open) eventEditor.showModal();
    markClean();
    renderEvents();
    fld("title").focus();
  };

  const closeEventDialog = () => {
    if (eventEditor?.open) eventEditor.close();
  };

  app.addEventListener("click", async (event) => {
    if (event.target.closest("[data-new-event]")) {
      resetEventForm();
      openEventDialog();
      return;
    }
    const edit = event.target.closest("[data-edit-event]");
    if (edit) {
      event.preventDefault();
      const ev = eventsCache.find((item) => item.id === edit.dataset.editEvent);
      if (!ev) return;
      fillEventForm(ev);
      openEventDialog();
      return;
    }
    const csv = event.target.closest("[data-csv-event]");
    if (csv) {
      try {
        const { csv: text } = await club({ action: "attendees_csv", event_id: csv.dataset.csvEvent });
        download(text, `${csv.dataset.csvSlug || "attendees"}.csv`);
      } catch (err) {
        showUndo(err.message || "Couldn't download the list");
      }
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
        cover_image: fld("cover_image").value || null,
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
      closeCheckins(id);
      closeEventDialog();
      eventFilter = "cancelled";
      soleClosed = "";
      document.querySelectorAll("[data-admin-filter]").forEach((el) => el.classList.toggle("is-on", el.dataset.adminFilter === "cancelled"));
      loadEvents();
      showUndo("Event cancelled");
    } catch (err) {
      const st = eventForm.querySelector(".form-status");
      st.textContent = err.message;
      st.classList.add("is-error");
    }
  });

  document.querySelector("[data-event-close]")?.addEventListener("click", closeEventDialog);
  eventEditor?.addEventListener("close", () => renderEvents());
  window.BULLDOGS_AUTH?.backdropClose(eventEditor, closeEventDialog);

  async function refreshAttendance(eventId) {
    const { attendees } = await club({ action: "list_attendees", event_id: eventId });
    attendanceCache[eventId] = attendees || [];
  }

  const bookingsHost = (eventId) => eventsList?.querySelector(`[data-event-bookings="${eventId}"]`) || null;

  function updateCap(eventId) {
    const ev = eventsCache.find((item) => item.id === eventId);
    const cap = eventsList?.querySelector(`[data-event-cap="${eventId}"]`);
    if (ev && cap) cap.innerHTML = spacesHtml(ev);
  }

  async function stopScanner() {
    scanEventId = null;
    if (!scanner) return;
    const current = scanner;
    scanner = null;
    try {
      await current.stop();
    } catch {
      /* already stopped */
    }
    try {
      current.clear();
    } catch {
      /* already clear */
    }
  }

  const paidPeople = (eventId) => (attendanceCache[eventId] || []).filter((row) => row.status === "paid");

  const matchingPeople = (eventId, query) => {
    const q = query.trim().toLowerCase();
    const rows = paidPeople(eventId);
    if (!q) return rows;
    return rows.filter((row) => {
      const mail = row.email || row.booking?.email || "";
      const booker = row.full_name || row.booking?.full_name || "";
      return (
        (row.attendee_name || "").toLowerCase().includes(q) ||
        mail.toLowerCase().includes(q) ||
        booker.toLowerCase().includes(q)
      );
    });
  };

  function renderPeople(eventId) {
    const host = bookingsHost(eventId);
    if (!host) return;
    const query = host.querySelector("[name=query]")?.value || "";
    bookingQuery[eventId] = query;
    const all = paidPeople(eventId);
    const people = matchingPeople(eventId, query);
    const inCount = all.filter((person) => person.checked_in_at).length;
    const ev = eventsCache.find((item) => item.id === eventId);
    const cancelled = ev ? isCancelled(ev) : false;
    const started = !cancelled && checkinOpen.has(eventId);
    const places = ev ? placeCounts(ev) : null;
    const counts = host.querySelector("[data-door-counts]");
    const list = host.querySelector("[data-door-people]");
    const track = host.querySelector("[data-seat-bar]");
    const gate = host.querySelector("[data-checkin-gate]");
    const scanBtn = host.querySelector("[data-start-scan]");
    const openBtn = host.querySelector("[data-open-checkin]");
    const closeBtn = host.querySelector("[data-close-checkin]");
    if (gate) {
      gate.hidden = cancelled ? false : started;
      if (cancelled) gate.textContent = "This event was cancelled.";
    }
    if (scanBtn) scanBtn.hidden = cancelled || !started;
    if (openBtn) openBtn.hidden = cancelled || started;
    if (closeBtn) closeBtn.hidden = cancelled || !started;
    if (places && counts) {
      const capacity = places.left == null ? null : places.left + places.taken;
      const left = places.left == null ? "Open" : String(places.left);
      counts.innerHTML = `
        <div><b>${capacity == null ? "Open" : capacity}</b><span>Spaces</span></div>
        <div><b>${all.length}</b><span class="count-booked">Booked</span></div>
        <div><b>${left}</b><span>Spaces left</span></div>
        <div><b>${inCount}</b><span class="count-in">Checked in</span></div>
        <div><b>${all.length - inCount}</b><span class="count-out">Not checked in</span></div>`;
    }
    if (track && places) track.innerHTML = seatTrack(places);
    if (!list) return;
    const initials = (name) =>
      String(name || "")
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0])
        .join("")
        .toUpperCase();
    const held = places?.held || 0;
    const heldNote = held
      ? `<p class="muted">${held} ${held === 1 ? "place is" : "places are"} held at checkout and not paid yet.</p>`
      : "";
    list.innerHTML = heldNote + (people.length
      ? people
          .map((person) => {
            const arrived = Boolean(person.checked_in_at);
            const note = person.medical_notes
              ? person.medical_notes.length > 28
                ? `${person.medical_notes.slice(0, 28)}…`
                : person.medical_notes
              : "";
            const whenIn = person.checked_in_at
              ? new Date(person.checked_in_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
              : "";
            const mail = person.email || person.booking?.email || "";
            const action = !started
              ? arrived
                ? `<span class="tick">In ${escapeHtml(whenIn)}</span>`
                : ""
              : arrived
                ? `<span class="tick">In ${escapeHtml(whenIn)}</span><button class="btn btn--ghost btn--small" type="button" data-undo-checkin="${escapeHtml(person.id)}">Undo check-in</button>`
                : `<button class="btn btn--accent btn--small" type="button" data-manual-check="${escapeHtml(person.checkin_token || "")}" ${person.checkin_token ? "" : "disabled"}>Check in</button>`;
            const meta = [person.attendee_date_of_birth && `DOB ${person.attendee_date_of_birth}`, mail].filter(Boolean).join(" · ");
            return `<article class="person${arrived ? " in" : ""}">
              <span class="av">${escapeHtml(initials(person.attendee_name) || "·")}</span>
              <div>
                <b>${escapeHtml(person.attendee_name || "Attendee")}</b>
                <small>${escapeHtml(meta)}</small>
              </div>
              ${note ? `<span class="flag">${escapeHtml(note)}</span>` : "<span></span>"}
              <div class="person__acts">${action}</div>
            </article>`;
          })
          .join("")
      : empty(query.trim() ? "No one matches that search." : "No one is booked yet."));
  }

  function renderBookings(eventId) {
    const host = bookingsHost(eventId);
    if (!host) return;
    if (attendanceCache[eventId] == null) {
      host.innerHTML = `<p class="form-status is-error">Couldn't load bookings.</p>`;
      return;
    }
    if (!host.querySelector("[data-door-people]")) {
      const cancelled = isCancelled(eventsCache.find((item) => item.id === eventId) || {});
      const started = !cancelled && checkinOpen.has(eventId);
      host.innerHTML = `
        <div class="door__count" data-door-counts></div>
        <div class="seat-bar seat-bar--track" data-seat-bar></div>
        <div class="ev-bookings__tools">
          <form data-search-door>
            <input name="query" type="search" placeholder="Search booked people" aria-label="Search booked people" value="${escapeHtml(bookingQuery[eventId] || "")}" />
          </form>
          <button class="btn btn--accent btn--small" type="button" data-open-checkin="${eventId}" ${cancelled || started ? "hidden" : ""}>Open check ins</button>
          <button class="btn btn--ghost btn--small" type="button" data-close-checkin="${eventId}" ${cancelled || !started ? "hidden" : ""}>Close check ins</button>
          <button class="btn btn--accent btn--small" type="button" data-start-scan ${cancelled || !started ? "hidden" : ""}>Scan ticket</button>
        </div>
        <p class="muted" data-checkin-gate ${cancelled || !started ? "" : "hidden"}>${cancelled ? "This event was cancelled." : "Open check ins to scan tickets and mark people in."}</p>
        <p class="checkin-note" data-checkin-note hidden></p>
        <div class="people" data-door-people></div>`;
    }
    renderPeople(eventId);
  }

  async function openEvent(eventId) {
    if (attendanceCache[eventId]) renderBookings(eventId);
    else {
      const host = bookingsHost(eventId);
      if (host) host.innerHTML = `<p class="muted">Loading bookings…</p>`;
    }
    try {
      await refreshAttendance(eventId);
    } catch {
      if (attendanceCache[eventId] == null) {
        const host = bookingsHost(eventId);
        if (host) host.innerHTML = `<p class="form-status is-error">Couldn't load bookings.</p>`;
        return;
      }
    }
    updateCap(eventId);
    if (!eventsList?.querySelector(`details[open][data-event-item="${eventId}"]`)) return;
    renderBookings(eventId);
  }

  async function updateEventPeople(eventId) {
    try {
      await refreshAttendance(eventId);
    } catch (err) {
      paintNote(eventId, scanCard(null, { error: err.message || "The list didn’t refresh." }));
    }
    updateCap(eventId);
    if (eventsList?.querySelector(`details[open][data-event-item="${eventId}"]`)) renderBookings(eventId);
  }

  let scanning = false;

  const scanCard = (person, state) => {
    if (!person) {
      return `<article class="scan-card scan-card--bad"><h3>Couldn't check in</h3><p>${escapeHtml(state.error || "Try the ticket again.")}</p></article>`;
    }
    const medical = person.medical_notes
      ? `<p class="flag">${escapeHtml(person.medical_notes)}</p>`
      : `<p>No medical notes</p>`;
    return `<article class="scan-card ${state.already ? "scan-card--warn" : "scan-card--ok"}">
      <p class="eyebrow">${state.already ? "Already checked in" : "Checked in"}</p>
      <h3>${escapeHtml(person.attendee_name || "Attendee")}</h3>
      <dl>
        <div><dt>Date of birth</dt><dd>${escapeHtml(person.attendee_date_of_birth || "—")}</dd></div>
        <div><dt>Emergency</dt><dd>${escapeHtml(person.emergency_contact_name || "—")} ${escapeHtml(person.emergency_contact_phone || "")}</dd></div>
        ${person.email ? `<div><dt>Email</dt><dd>${escapeHtml(person.email)}</dd></div>` : ""}
      </dl>
      ${medical}
      ${person.id ? `<button class="btn btn--ghost btn--small" type="button" data-undo-checkin="${escapeHtml(person.id)}">Undo check-in</button>` : ""}
    </article>`;
  };

  const paintNote = (eventId, html) => {
    const note = bookingsHost(eventId)?.querySelector("[data-checkin-note]");
    if (!note) return;
    note.hidden = !html;
    note.innerHTML = html;
  };

  const paintModal = (html) => {
    const box = scanDialog?.querySelector("[data-scan-person]");
    if (box) box.innerHTML = html;
  };

  async function onScan(text, eventId, modal) {
    if (scanning || !eventId) return;
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
      const result = await club({ action: "checkin", token, event_id: eventId, opened: checkinOpen.has(eventId) });
      const person = result.attendee;
      const card = scanCard(person, { already: Boolean(result.already) });
      if (modal) paintModal(card);
      else paintNote(eventId, card);
      await updateEventPeople(eventId);
      if (!result.already && person?.id) {
        showUndo(`${person.attendee_name || "Attendee"} checked in`, async () => {
          await club({ action: "undo_checkin", registration_id: person.id });
          await updateEventPeople(eventId);
          if (modal) paintModal(`<p class="muted">Check-in undone. Scan the next ticket.</p>`);
        });
      }
    } catch (err) {
      const card = scanCard(null, { error: err.message });
      if (modal) paintModal(card);
      else paintNote(eventId, card);
    } finally {
      scanning = false;
    }
  }

  const confirmDialog = document.querySelector("[data-checkin-confirm]");

  function askOpenAnyway(ev) {
    const title = ev?.title || "This event";
    const when = ev?.starts_at ? new Date(ev.starts_at) : null;
    const dated = when && !Number.isNaN(when.getTime())
      ? when.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
      : "";
    const message = dated
      ? `${title} is on ${dated}, not today. Open check ins anyway?`
      : `${title} is not scheduled for today. Open check ins anyway?`;
    if (!confirmDialog) return Promise.resolve(window.confirm(message));
    const copy = confirmDialog.querySelector("[data-checkin-confirm-copy]");
    if (copy) copy.textContent = message;
    confirmDialog.returnValue = "";
    return new Promise((resolve) => {
      const finish = () => {
        confirmDialog.removeEventListener("close", finish);
        resolve(confirmDialog.returnValue === "ok");
      };
      confirmDialog.addEventListener("close", finish);
      confirmDialog.showModal();
    });
  }

  confirmDialog?.querySelector("[data-checkin-confirm-cancel]")?.addEventListener("click", () => {
    confirmDialog.close("cancel");
  });
  window.BULLDOGS_AUTH?.backdropClose(confirmDialog, () => confirmDialog.close("cancel"));

  async function openCheckins(eventId) {
    if (!eventId || checkinOpen.has(eventId)) return;
    const ev = eventsCache.find((item) => item.id === eventId);
    if (!ev || !eventOnToday(ev)) {
      if (!(await askOpenAnyway(ev))) return;
    }
    checkinOpen.add(eventId);
    saveCheckins();
    const item = eventsList?.querySelector(`[data-event-item="${eventId}"]`);
    if (item && !item.open) item.open = true;
    renderEvents();
  }

  function closeCheckins(eventId) {
    if (!eventId || !checkinOpen.has(eventId)) return;
    checkinOpen.delete(eventId);
    saveCheckins();
    if (scanEventId === eventId) closeScan();
    renderEvents();
  }

  async function startScan(eventId) {
    if (!scanDialog || !checkinOpen.has(eventId)) return;
    if (scanDialog.open && scanEventId === eventId) return;
    const ev = eventsCache.find((item) => item.id === eventId);
    const title = scanDialog.querySelector("[data-scan-title]");
    if (title) title.textContent = ev?.title || "Scan ticket";
    paintModal(`<p class="muted">Point the camera at a ticket.</p>`);
    if (!scanDialog.open) scanDialog.showModal();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const host = scanDialog.querySelector("#club-scan-qr");
    if (!host) return;
    const cameraError = (message) => {
      host.hidden = true;
      host.replaceChildren();
      scanEventId = null;
      scanner = null;
      paintModal(`<p>${escapeHtml(message)}</p>`);
    };
    if (!window.Html5Qrcode) {
      cameraError("Camera scanner couldn’t load. Check someone in from the list.");
      return;
    }
    await stopScanner();
    scanEventId = eventId;
    host.hidden = false;
    host.replaceChildren();
    scanner = new window.Html5Qrcode("club-scan-qr");
    scanner.start({ facingMode: "environment" }, { fps: 8, qrbox: 180 }, (value) => onScan(value, eventId, true)).catch(() => {
      cameraError("Camera unavailable. Check someone in from the list.");
    });
  }

  const closeScan = () => {
    if (scanDialog?.open) scanDialog.close();
  };

  scanDialog?.addEventListener("close", () => {
    void stopScanner();
  });
  scanDialog?.querySelector("[data-scan-close]")?.addEventListener("click", closeScan);
  window.BULLDOGS_AUTH?.backdropClose(scanDialog, closeScan);

  scanDialog?.addEventListener("click", async (event) => {
    const undo = event.target.closest("[data-undo-checkin]");
    if (!undo || !scanEventId) return;
    undo.disabled = true;
    try {
      await club({ action: "undo_checkin", registration_id: undo.dataset.undoCheckin });
      await updateEventPeople(scanEventId);
      paintModal(`<p class="muted">Check-in undone. Scan the next ticket.</p>`);
      showUndo("Check-in undone");
    } catch (err) {
      undo.disabled = false;
      paintModal(scanCard(null, { error: err.message || "Couldn't undo that check-in" }));
    }
  });

  eventsList?.addEventListener(
    "toggle",
    (event) => {
      const item = event.target;
      if (!(item instanceof HTMLDetailsElement) || !item.dataset.eventItem) return;
      if (!item.open) {
        if (eventFilter === "today") {
          const visible = eventsCache.filter(eventMatches);
          if (visible.length === 1 && visible[0].id === item.dataset.eventItem) soleClosed = item.dataset.eventItem;
        }
        if (scanEventId === item.dataset.eventItem) closeScan();
        return;
      }
      if (soleClosed === item.dataset.eventItem) soleClosed = "";
      openEvent(item.dataset.eventItem);
    },
    true,
  );

  eventsList?.addEventListener("input", (event) => {
    const form = event.target.closest("[data-search-door]");
    if (!form) return;
    const eventId = form.closest("[data-event-item]")?.dataset.eventItem;
    if (eventId) renderPeople(eventId);
  });

  eventsList?.addEventListener("submit", (event) => {
    if (!event.target.closest("[data-search-door]")) return;
    event.preventDefault();
  });

  eventsList?.addEventListener("click", async (event) => {
    if (event.target.closest("[data-edit-event]")) event.preventDefault();
    const begin = event.target.closest("[data-open-checkin]");
    const end = event.target.closest("[data-close-checkin]");
    const start = event.target.closest("[data-start-scan]");
    const manual = event.target.closest("[data-manual-check]");
    const undo = event.target.closest("[data-undo-checkin]");
    const eventId = begin?.dataset.openCheckin || end?.dataset.closeCheckin || event.target.closest("[data-event-item]")?.dataset.eventItem;
    if (begin && eventId) {
      openCheckins(eventId);
      return;
    }
    if (end && eventId) {
      closeCheckins(eventId);
      return;
    }
    if (start && eventId) {
      await startScan(eventId);
      return;
    }
    if (manual && eventId) {
      if (!checkinOpen.has(eventId)) return;
      await onScan(manual.dataset.manualCheck, eventId, false);
      return;
    }
    if (undo && eventId) {
      undo.disabled = true;
      try {
        await club({ action: "undo_checkin", registration_id: undo.dataset.undoCheckin });
        await updateEventPeople(eventId);
        paintNote(eventId, "");
        showUndo("Check-in undone");
      } catch (err) {
        undo.disabled = false;
        paintNote(eventId, scanCard(null, { error: err.message || "Couldn't undo that check-in" }));
      }
    }
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
      const sizeRank = { S: 0, M: 1, L: 2, XL: 3 };
      const colourRank = { orange: 0, blue: 1 };
      const byItem = new Map();
      for (const variant of rows) {
        const colour = String(variant.colour || "Other");
        const key = `${variant.product_id}|${colour}`;
        if (!byItem.has(key)) byItem.set(key, []);
        byItem.get(key).push(variant);
      }
      const itemName = (variant) => {
        const product = variant.product;
        return product && typeof product === "object" && product.name ? String(product.name) : "Bulldogs Tee";
      };
      const items = [...byItem.values()].sort((a, b) => {
        const name = itemName(a[0]).localeCompare(itemName(b[0]));
        if (name) return name;
        return (colourRank[String(a[0].colour || "").toLowerCase()] ?? 9) - (colourRank[String(b[0].colour || "").toLowerCase()] ?? 9)
          || String(a[0].colour || "").localeCompare(String(b[0].colour || ""));
      });
      const sizeRow = (v) => {
        const colour = String(v.colour || "");
        const counted = Number(v.on_hand || 0);
        const toFulfil = Number(v.to_fulfil || 0);
        const reserved = Number(v.checkout_reserved || 0);
        const held = toFulfil + reserved;
        const left = Math.max(0, counted - held);
        return `<div class="stock-size${left <= 2 ? " is-low" : ""}">
          <div class="stock-size__size"><b>${escapeHtml(v.size)}</b><span class="low"${left > 2 ? " hidden" : ""}>Low</span></div>
          <div class="stock-size__hand">
            <span class="stock-size__label">Counted</span>
            <span class="step"><button type="button" data-step="-1" aria-label="Decrease ${escapeHtml(colour)} ${escapeHtml(v.size)}">−</button><input data-onhand data-product="${escapeHtml(v.product_id)}" data-colour="${escapeHtml(v.colour)}" data-size="${escapeHtml(v.size)}" data-original="${v.on_hand}" data-reserved="${held}" data-to-fulfil="${toFulfil}" data-checkout-reserved="${reserved}" type="number" min="0" value="${v.on_hand}" aria-label="Counted ${escapeHtml(colour)} ${escapeHtml(v.size)}" /><button type="button" data-step="1" aria-label="Increase ${escapeHtml(colour)} ${escapeHtml(v.size)}">+</button></span>
          </div>
          <dl class="stock-size__stats">
            <div class="stock-size__stat">
              <strong data-to-fulfil>${stockHold(toFulfil)}</strong>
              <span>to fulfil</span>
            </div>
            <div class="stock-size__stat">
              <strong data-checkout-reserved>${stockHold(reserved)}</strong>
              <span>reserved</span>
            </div>
            <div class="stock-size__shop">
              <strong data-left>${left}</strong>
              <span>in stock</span>
            </div>
          </dl>
        </div>`;
      };
      stockTable.innerHTML = `<div class="stock-list">${items
        .map((sizes) => {
          const sample = sizes[0];
          const colour = String(sample.colour || "Other");
          const name = itemName(sample);
          const img = productImage(colour, sample.product_id, name);
          const ordered = sizes.slice().sort((a, b) => (sizeRank[a.size] ?? 9) - (sizeRank[b.size] ?? 9));
          const toFulfil = ordered.reduce((sum, v) => sum + Number(v.to_fulfil || 0), 0);
          const reserved = ordered.reduce((sum, v) => sum + Number(v.checkout_reserved || 0), 0);
          const left = ordered.reduce((sum, v) => {
            const held = Number(v.to_fulfil || 0) + Number(v.checkout_reserved || 0);
            return sum + Math.max(0, Number(v.on_hand) - held);
          }, 0);
          const anyLow = ordered.some((v) => {
            const held = Number(v.to_fulfil || 0) + Number(v.checkout_reserved || 0);
            return Math.max(0, Number(v.on_hand) - held) <= 2;
          });
          const key = `${sample.product_id}|${colour}`;
          const open = openStockKeys.has(key);
          return `<details class="stock-item" data-stock-key="${escapeHtml(key)}"${open ? " open" : ""}>
            <summary class="stock-item__head">
              <img class="stock-item__img" src="${escapeHtml(img)}" alt="" />
              <div class="stock-item__name">
                <b>${escapeHtml(name)}</b>
                <small>${escapeHtml(colourLabel(colour))}</small>
              </div>
              <dl class="stock-item__stats">
                <div><dt>To fulfil</dt><dd data-item-fulfil>${stockHold(toFulfil)}</dd></div>
                <div><dt>Reserved</dt><dd data-item-reserved>${stockHold(reserved)}</dd></div>
                <div>
                  <dt>In stock</dt>
                  <dd data-item-left>${left}</dd>
                  <span class="low" data-item-low${anyLow ? "" : " hidden"}>Low</span>
                </div>
              </dl>
            </summary>
            <div class="stock-sizes">${ordered.map(sizeRow).join("")}</div>
          </details>`;
        })
        .join("")}</div>`;
      setStockDirty(false);
      if (stockStatus) stockStatus.textContent = "";
    } catch (err) {
      fail(stockTable, err);
    }
  }

  stockTable?.addEventListener("toggle", (event) => {
    const item = event.target.closest("[data-stock-key]");
    if (!item || event.target !== item) return;
    const key = item.dataset.stockKey;
    if (!key) return;
    if (item.open) openStockKeys.add(key);
    else openStockKeys.delete(key);
  }, true);

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
    const counted = Number(input.value || 0);
    const held = Number(input.dataset.reserved || 0);
    const left = Math.max(0, counted - held);
    const size = input.closest(".stock-size");
    const leftCell = size?.querySelector("[data-left]");
    if (leftCell) leftCell.textContent = String(left);
    const low = size?.querySelector(".low");
    if (low) low.hidden = left > 2;
    size?.classList.toggle("is-low", left <= 2);
    const item = input.closest(".stock-item");
    if (item) {
      let total = 0;
      let fulfilTotal = 0;
      let reservedTotal = 0;
      let anyLow = false;
      item.querySelectorAll("[data-onhand]").forEach((field) => {
        const fulfil = Number(field.dataset.toFulfil || 0);
        const reserved = Number(field.dataset.checkoutReserved || 0);
        const held = Number(field.dataset.reserved || 0);
        const n = Math.max(0, Number(field.value || 0) - held);
        total += n;
        fulfilTotal += fulfil;
        reservedTotal += reserved;
        if (n <= 2) anyLow = true;
      });
      const label = item.querySelector("[data-item-left]");
      if (label) label.textContent = String(total);
      const fulfilLabel = item.querySelector("[data-item-fulfil]");
      if (fulfilLabel) fulfilLabel.textContent = stockHold(fulfilTotal);
      const reservedLabel = item.querySelector("[data-item-reserved]");
      if (reservedLabel) reservedLabel.textContent = stockHold(reservedTotal);
      const badge = item.querySelector("[data-item-low]");
      if (badge) badge.hidden = !anyLow;
    }
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

  const visibleOrders = () => ordersCache.filter((order) => ["paid", "fulfilled", "refunded"].includes(order.status));

  const paintOrderFilters = () => {
    const rows = visibleOrders();
    const counts = { paid: 0, fulfilled: 0, refunded: 0, all: rows.length };
    for (const order of rows) {
      if (counts[order.status] != null) counts[order.status] += 1;
    }
    const labels = { paid: "To fulfil", fulfilled: "Fulfilled", refunded: "Refunded", all: "All" };
    document.querySelectorAll("[data-order-filter]").forEach((btn) => {
      const key = btn.dataset.orderFilter;
      btn.textContent = `${labels[key] || key} · ${counts[key] ?? 0}`;
    });
  };

  const orderPill = (status) => {
    if (status === "paid") return `<span class="pill pill--sky">To fulfil</span>`;
    if (status === "fulfilled") return `<span class="pill pill--live">Fulfilled</span>`;
    if (status === "refunded") return `<span class="pill pill--cancelled">Refunded</span>`;
    return `<span class="pill">${escapeHtml(status || "")}</span>`;
  };

  const orderItemThumbs = (items) => {
    const list = items || [];
    if (!list.length) return `<span class="order-row__thumbs order-row__thumbs--empty" aria-hidden="true"></span>`;
    return `<span class="order-row__thumbs">${list
      .slice(0, 3)
      .map((item) => `<img src="${escapeHtml(productImage(item.colour, item.product_id, item.product_name))}" alt="" />`)
      .join("")}${list.length > 3 ? `<span>+${list.length - 3}</span>` : ""}</span>`;
  };

  const orderItemSummary = (items) => {
    const list = items || [];
    if (!list.length) return "No items";
    return list
      .map((item) => {
        const colour = String(item.colour || "").trim();
        const size = item.size ? ` ${item.size}` : "";
        const qty = Number(item.quantity || 1);
        const label = colour ? `${colour.charAt(0).toUpperCase()}${colour.slice(1)}${size}` : `${item.product_name || "Item"}${size}`;
        return qty > 1 ? `${label} ×${qty}` : label;
      })
      .join(" · ");
  };

  const paintOrderSummary = () => {
    if (!orderSummary) return;
    const sizeRank = { S: 0, M: 1, L: 2, XL: 3 };
    const colourRank = { orange: 0, blue: 1 };
    const byProduct = new Map();
    for (const order of ordersCache) {
      if (!["pending", "paid", "fulfilled"].includes(order.status)) continue;
      for (const item of order.items || []) {
        const productKey = `${item.product_id || ""}|${item.colour || ""}`;
        if (!byProduct.has(productKey)) {
          byProduct.set(productKey, {
            key: productKey,
            product_id: item.product_id,
            product_name: item.product_name || "Item",
            colour: item.colour || "",
            ordered: 0,
            shipped: 0,
            reserved: 0,
            sizes: new Map(),
          });
        }
        const product = byProduct.get(productKey);
        const sizeKey = String(item.size || "—");
        if (!product.sizes.has(sizeKey)) {
          product.sizes.set(sizeKey, { size: sizeKey, ordered: 0, shipped: 0, reserved: 0 });
        }
        const sizeRow = product.sizes.get(sizeKey);
        const qty = Number(item.quantity || 0);
        if (order.status === "pending") {
          product.reserved += qty;
          sizeRow.reserved += qty;
        }
        if (order.status === "paid" || order.status === "fulfilled") {
          product.ordered += qty;
          sizeRow.ordered += qty;
        }
        if (order.status === "fulfilled") {
          product.shipped += qty;
          sizeRow.shipped += qty;
        }
      }
    }
    const groups = [...byProduct.values()]
      .filter((row) => row.ordered || row.shipped || row.reserved)
      .sort((a, b) => {
        const name = String(a.product_name).localeCompare(String(b.product_name));
        if (name) return name;
        return (colourRank[String(a.colour).toLowerCase()] ?? 9) - (colourRank[String(b.colour).toLowerCase()] ?? 9)
          || String(a.colour).localeCompare(String(b.colour));
      });
    if (!groups.length) {
      if (orderSummaryPanel) orderSummaryPanel.hidden = true;
      orderSummary.innerHTML = "";
      return;
    }
    if (orderSummaryPanel) orderSummaryPanel.hidden = false;
    orderSummary.innerHTML = `<div class="order-summary__list">${groups
      .map((group) => {
        const img = productImage(group.colour, group.product_id, group.product_name);
        const open = openSummaryKeys.has(group.key);
        const sizes = [...group.sizes.values()].sort((a, b) => (sizeRank[a.size] ?? 9) - (sizeRank[b.size] ?? 9));
        return `<details class="order-summary__item" data-summary-key="${escapeHtml(group.key)}"${open ? " open" : ""}>
          <summary>
            <img src="${escapeHtml(img)}" alt="" />
            <span class="order-summary__name">
              <b>${escapeHtml(group.product_name)}</b>
              <small>${escapeHtml(colourLabel(group.colour))}</small>
            </span>
            <dl class="order-summary__stats">
              <div><dt>Ordered</dt><dd>${stockHold(group.ordered)}</dd></div>
              <div><dt>Shipped</dt><dd>${stockHold(group.shipped)}</dd></div>
              <div><dt>Reserved</dt><dd>${stockHold(group.reserved)}</dd></div>
            </dl>
          </summary>
          <div class="order-summary__sizes">
            ${sizes
              .map(
                (size) => `<div class="order-summary__size">
                  <b>${escapeHtml(size.size)}</b>
                  <span class="order-summary__size-gap" aria-hidden="true"></span>
                  <dl class="order-summary__stats">
                    <div><dt>Ordered</dt><dd>${stockHold(size.ordered)}</dd></div>
                    <div><dt>Shipped</dt><dd>${stockHold(size.shipped)}</dd></div>
                    <div><dt>Reserved</dt><dd>${stockHold(size.reserved)}</dd></div>
                  </dl>
                </div>`,
              )
              .join("")}
          </div>
        </details>`;
      })
      .join("")}</div>`;
  };

  orderSummary?.addEventListener("toggle", (event) => {
    const item = event.target.closest("[data-summary-key]");
    if (!item || event.target !== item) return;
    const key = item.dataset.summaryKey;
    if (!key) return;
    if (item.open) openSummaryKeys.add(key);
    else openSummaryKeys.delete(key);
  }, true);

  function renderOrders() {
    paintOrderFilters();
    paintOrderSummary();
    const rows = orderFilter === "all" ? visibleOrders() : visibleOrders().filter((o) => o.status === orderFilter);
    if (!rows.length) {
      ordersList.innerHTML = empty(orderFilter === "all" ? "No orders yet." : "Nothing in this view.");
      return;
    }
    ordersList.innerHTML = rows
      .map((o) => {
        const who = o.customer_name || o.customer_email || "Order";
        const items = o.items || [];
        const qty = items.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
        return `<button class="order-row" type="button" data-open-order="${escapeHtml(o.id)}">
          ${orderItemThumbs(items)}
          <span class="order-row__main">
            <span class="order-row__who">${escapeHtml(who)}</span>
            <span class="order-row__meta">${escapeHtml(orderItemSummary(items))}${qty ? ` · ${qty} item${qty === 1 ? "" : "s"}` : ""}</span>
          </span>
          <span class="order-row__side">
            ${orderPill(o.status)}
            <strong>${gbp(orderPence(o))}</strong>
            <small>${escapeHtml(whenFmt(o.created_at))}</small>
          </span>
        </button>`;
      })
      .join("");
  }

  const paintOrderDialog = (order) => {
    if (!orderBody || !order) return;
    const items = order.items || [];
    const who = order.customer_name || "Customer";
    const email = order.customer_email || "";
    const addr = formatAddress(order.shipping_address);
    const ship = Number(order.amount_shipping_pence || 0);
    const note = order.fulfilment_notes || "";
    const itemCards = items.length
      ? items
          .map((item) => {
            const src = productImage(item.colour, item.product_id, item.product_name);
            return `<article class="pack-item">
              <img src="${escapeHtml(src)}" alt="" />
              <div>
                <b>${escapeHtml(item.product_name || "Item")}</b>
                <p>${escapeHtml(colourLabel(item.colour))} · Size ${escapeHtml(item.size || "—")}</p>
                <p class="pack-item__qty">× ${escapeHtml(String(item.quantity || 1))}</p>
              </div>
              <strong>${gbp(Number(item.unit_price_pence || 0) * Number(item.quantity || 1))}</strong>
            </article>`;
          })
          .join("")
      : `<p class="muted">No line items on this order.</p>`;
    const actions =
      order.status === "paid"
        ? `<div class="order-dialog__acts">
            <label class="field">
              <span>Tracking or note</span>
              <input type="text" maxlength="500" placeholder="Optional" data-note="${escapeHtml(order.id)}" value="${escapeHtml(note)}" />
            </label>
            <div class="order-dialog__btns">
              <button class="btn btn--accent" type="button" data-fulfil="${escapeHtml(order.id)}">Mark fulfilled</button>
              <button class="btn btn--ghost" type="button" data-refund="${escapeHtml(order.id)}">Refund</button>
            </div>
          </div>`
        : note
          ? `<p class="order-dialog__note muted">Note: ${escapeHtml(note)}</p>`
          : "";
    orderBody.innerHTML = `
      <header class="booking-dialog__head">
        <p class="eyebrow">Order</p>
        <h2>#${escapeHtml((order.id || "").slice(0, 8).toUpperCase())}</h2>
        <p class="muted">${escapeHtml(whenFmt(order.created_at))} · ${orderPill(order.status)}</p>
      </header>
      <section class="order-dialog__ship">
        <h3>Ship to</h3>
        <p><b>${escapeHtml(who)}</b>${email ? `<br /><a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a>` : ""}</p>
        ${addr ? `<p>${escapeHtml(addr)}</p>` : `<p class="muted">No address on file.</p>`}
      </section>
      <section class="order-dialog__pack">
        <h3>Pack</h3>
        <div class="pack-list">${itemCards}</div>
      </section>
      <section class="order-dialog__total">
        <div><span>Subtotal</span><b>${gbp(order.amount_subtotal_pence)}</b></div>
        <div><span>Delivery</span><b>${ship ? gbp(ship) : "—"}</b></div>
        <div class="order-dialog__grand"><span>Total</span><strong>${gbp(orderPence(order))}</strong></div>
      </section>
      ${actions}`;
  };

  const openOrder = (id) => {
    const order = ordersCache.find((row) => row.id === id);
    if (!order || !orderDialog) return;
    paintOrderDialog(order);
    if (!orderDialog.open) orderDialog.showModal();
  };

  const closeOrder = () => {
    if (orderDialog?.open) orderDialog.close();
  };

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

  ordersList?.addEventListener("click", (event) => {
    const open = event.target.closest("[data-open-order]");
    if (!open) return;
    openOrder(open.dataset.openOrder);
  });

  document.querySelector("[data-order-close]")?.addEventListener("click", closeOrder);
  orderDialog?.addEventListener("click", (event) => {
    if (event.target === orderDialog) closeOrder();
  });

  orderBody?.addEventListener("click", async (event) => {
    const fulfil = event.target.closest("[data-fulfil]");
    const refund = event.target.closest("[data-refund]");
    if (!fulfil && !refund) return;
    try {
      if (fulfil) {
        const notes = orderBody.querySelector(`[data-note="${fulfil.dataset.fulfil}"]`)?.value;
        await club({ action: "fulfil_order", order_id: fulfil.dataset.fulfil, fulfilment_notes: notes });
        closeOrder();
        await loadOrders();
        await loadStock();
        showUndo("Order marked fulfilled");
      }
      if (refund) {
        if (!confirm("Refund this order? Only do this if it hasn’t gone to print.")) return;
        await club({ action: "refund_order", order_id: refund.dataset.refund });
        closeOrder();
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
