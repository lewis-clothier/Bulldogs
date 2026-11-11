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
  const eventDialog = document.querySelector("[data-event-dialog]");
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
    document.querySelectorAll("[data-panel]").forEach((panel) => {
      panel.hidden = panel.getAttribute("data-panel") !== name;
    });
    if (name !== "door") stopScanner();
    if (name === "door") fillDoorSelect();
    if (name === "admins") loadAdmins();
    if (name === "news") loadNews();
  };

  document.querySelectorAll("[data-tab]").forEach((btn) => {
    btn.addEventListener("click", () => setTab(btn.dataset.tab));
  });

  async function loadEvents() {
    if (!eventsList) return;
    try {
      const { events } = await club({ action: "list_events" });
      eventsCache = events || [];
      renderEvents();
      fillDoorSelect();
    } catch (err) {
      fail(eventsList, err);
    }
  }

  function renderEvents() {
    if (!eventsCache.length) {
      eventsList.innerHTML = empty("No events yet. Create one to put it on the site.");
      return;
    }
    eventsList.innerHTML = `<div class="admin-cards">${eventsCache
      .map((ev) => {
        const status = eventStatus(ev);
        const price = Number(ev.price_pence || 0) === 0 ? "Free" : gbp(ev.price_pence);
        const cap = ev.capacity == null ? "Open capacity" : `${ev.capacity} places`;
        return `<article class="admin-card">
          <div class="admin-card__top">
            <h3>${escapeHtml(ev.title)}</h3>
            <span class="admin-pill admin-pill--${status.kind}">${status.label}</span>
          </div>
          <p class="muted">${escapeHtml(whenFmt(ev.starts_at))}${ev.location ? ` · ${escapeHtml(ev.location)}` : ""}</p>
          <p class="muted">${price} · ${escapeHtml(cap)}</p>
          <div class="admin-actions">
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

  const openEventDialog = () => {
    if (!eventDialog.open) eventDialog.showModal();
  };

  const closeEventDialog = () => {
    if (eventDialog.open) eventDialog.close();
  };

  app.addEventListener("click", async (event) => {
    if (event.target.closest("[data-new-event]")) {
      resetEventForm();
      openEventDialog();
      fld("title").focus();
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
      await club({
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
      st.textContent = "Saved.";
      st.classList.remove("is-error");
      closeEventDialog();
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
    } catch (err) {
      const st = eventForm.querySelector(".form-status");
      st.textContent = err.message;
      st.classList.add("is-error");
    }
  });

  document.querySelector("[data-event-close]")?.addEventListener("click", closeEventDialog);
  eventDialog?.addEventListener("click", (event) => {
    if (event.target === eventDialog) closeEventDialog();
  });

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
    if (doorBody.querySelector(".admin-door")) return;
    doorBody.innerHTML = `
      <div class="admin-door">
        <div class="admin-door__tools">
          <form data-search-door>
            <div class="field">
              <input name="query" type="search" placeholder="Search name or email" aria-label="Search attendees" />
            </div>
          </form>
          <button class="btn btn--accent btn--small" type="button" data-start-scan>Scan ticket</button>
        </div>
        <div id="club-qr" class="admin-qr" hidden></div>
        <div data-scan-result></div>
        <p class="muted" data-door-counts></p>
        <div class="admin-people" data-door-people></div>
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
    if (counts) counts.textContent = `${waiting} waiting · ${inCount} in`;
    if (!list) return;
    list.innerHTML = people.length
      ? people
          .map((p) => {
            const inDoor = Boolean(p.checked_in_at);
            const medical = p.medical_notes ? `<p class="admin-flag">${escapeHtml(p.medical_notes)}</p>` : "";
            const action = inDoor
              ? `<span class="admin-pill admin-pill--live">In</span>`
              : `<button class="btn btn--accent btn--small" type="button" data-manual-check="${escapeHtml(p.checkin_token || "")}">Check in</button>`;
            return `<article class="admin-person">
              <div>
                <strong>${escapeHtml(p.attendee_name)}</strong>
                <p class="muted">${escapeHtml(p.email || "")}${p.attendee_date_of_birth ? ` · ${escapeHtml(p.attendee_date_of_birth)}` : ""}</p>
                ${medical}
              </div>
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
      token = url.searchParams.get("t") || url.searchParams.get("c") || text;
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
        stockSave.hidden = true;
        return;
      }
      stockTable.innerHTML = `<div class="admin-table-wrap"><table class="admin-table">
        <thead><tr><th>Product</th><th>Colour</th><th>Size</th><th>On hand</th><th>Reserved</th><th>Sold</th><th>Available</th></tr></thead>
        <tbody>${rows
          .map((v) => {
            const avail = v.on_hand - v.reserved - v.sold;
            return `<tr>
              <td>${escapeHtml(v.product?.name || v.product_id)}</td>
              <td>${escapeHtml(v.colour)}</td>
              <td>${escapeHtml(v.size)}</td>
              <td><input class="admin-num" data-onhand data-product="${escapeHtml(v.product_id)}" data-colour="${escapeHtml(v.colour)}" data-size="${escapeHtml(v.size)}" data-original="${v.on_hand}" type="number" min="0" value="${v.on_hand}" /></td>
              <td>${v.reserved}</td>
              <td>${v.sold}</td>
              <td data-avail>${avail}</td>
            </tr>`;
          })
          .join("")}</tbody></table></div>`;
      stockSave.hidden = true;
      if (stockStatus) stockStatus.textContent = "";
    } catch (err) {
      fail(stockTable, err);
    }
  }

  const stockDirty = () =>
    [...stockTable.querySelectorAll("[data-onhand]")].some((input) => input.value !== input.dataset.original);

  stockTable?.addEventListener("input", (event) => {
    const input = event.target.closest("[data-onhand]");
    if (!input) return;
    const row = input.closest("tr");
    const reserved = Number(row?.children[4]?.textContent || 0);
    const sold = Number(row?.children[5]?.textContent || 0);
    const avail = row?.querySelector("[data-avail]");
    if (avail) avail.textContent = Number(input.value || 0) - reserved - sold;
    if (stockSave) stockSave.hidden = !stockDirty();
  });

  stockSave?.addEventListener("click", async () => {
    if (stockSave.hidden) return;
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
    } catch (err) {
      fail(ordersList, err);
    }
  }

  function renderOrders() {
    const rows = orderFilter === "all" ? ordersCache : ordersCache.filter((o) => o.status === orderFilter);
    if (!rows.length) {
      ordersList.innerHTML = empty(orderFilter === "all" ? "No orders yet." : `No ${orderFilter} orders.`);
      return;
    }
    ordersList.innerHTML = `<div class="admin-cards">${rows
      .map((o) => {
        const items = (o.items || [])
          .map((i) => `${i.quantity}× ${escapeHtml(i.product_name)} ${escapeHtml(i.colour || "")} ${escapeHtml(i.size || "")}`)
          .join("<br>");
        const addr = o.shipping_address
          ? [o.shipping_address.line1, o.shipping_address.city, o.shipping_address.postal_code].filter(Boolean).join(", ")
          : "";
        const pillKind = o.status === "paid" ? "live" : o.status === "fulfilled" ? "closed" : "draft";
        const actions =
          o.status === "paid"
            ? `<div class="admin-fulfil">
                <input placeholder="Tapstitch / note" data-note="${o.id}" />
                <button class="btn btn--accent btn--small" type="button" data-fulfil="${o.id}">Mark fulfilled</button>
                <button class="text-btn admin-danger" type="button" data-refund="${o.id}">Refund</button>
              </div>`
            : "";
        return `<article class="admin-card">
          <div class="admin-card__top">
            <h3>${escapeHtml((o.customer_name || o.customer_email || o.id).toString())}</h3>
            <span class="admin-pill admin-pill--${pillKind}">${escapeHtml(o.status)}</span>
          </div>
          <p class="muted">${escapeHtml((o.id || "").slice(0, 8).toUpperCase())} · ${escapeHtml(whenFmt(o.created_at))}</p>
          <p>${escapeHtml(o.customer_email || "")} ${escapeHtml(o.customer_phone || "")}</p>
          <p>${items}</p>
          ${addr ? `<p class="muted">${escapeHtml(addr)}</p>` : ""}
          ${actions}
        </article>`;
      })
      .join("")}</div>`;
  }

  document.querySelector("[data-order-filters]")?.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-order-filter]");
    if (!btn) return;
    orderFilter = btn.dataset.orderFilter;
    document.querySelectorAll("[data-order-filter]").forEach((el) => el.classList.toggle("is-active", el === btn));
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
      }
      if (refund) {
        if (!confirm("Refund this order? Only do this if it hasn’t gone to print.")) return;
        await club({ action: "refund_order", order_id: refund.dataset.refund });
        await loadOrders();
        await loadStock();
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
