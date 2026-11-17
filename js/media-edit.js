(() => {
  const api = () => window.BULLDOGS_API;
  const media = () => window.BULLDOGS_MEDIA;
  const IMG_SELECTOR = "img[data-editable-media], img[data-site-media]";

  let editing = false;
  let pending = null;
  let previewUrl = null;
  let showingNew = true;
  let admin = false;

  const ensureDock = () => {
    let dock = document.querySelector("[data-media-edit-dock]");
    if (dock) return dock;
    dock = document.createElement("div");
    dock.className = "media-edit-dock";
    dock.dataset.mediaEditDock = "";
    dock.hidden = true;
    dock.innerHTML = `
      <div class="media-edit-dock__inner">
        <div class="media-edit-dock__copy">
          <p class="eyebrow">Photo change</p>
          <p data-media-dock-label>Previewing on the page</p>
          <p class="form-status" data-media-dock-status></p>
        </div>
        <div class="media-edit-dock__acts">
          <div class="media-edit-dock__swap" role="group" aria-label="Compare photos">
            <button type="button" data-media-dock-view="old">Old</button>
            <button type="button" class="is-active" data-media-dock-view="new">New</button>
          </div>
          <button class="btn btn--ghost btn--small" type="button" data-media-dock-cancel>Cancel</button>
          <button class="btn btn--accent btn--small" type="button" data-media-dock-confirm>Confirm</button>
        </div>
      </div>`;
    document.body.appendChild(dock);
    return dock;
  };

  const ensureFileInput = () => {
    let input = document.querySelector("[data-media-edit-file]");
    if (input) return input;
    input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.hidden = true;
    input.dataset.mediaEditFile = "";
    document.body.appendChild(input);
    return input;
  };

  const syncMenuItem = () => {
    const item = document.querySelector("[data-media-edit-toggle]");
    if (!item) return;
    item.hidden = !admin;
    item.setAttribute("aria-pressed", editing ? "true" : "false");
    item.classList.toggle("is-on", editing);
    const label = item.querySelector("[data-media-edit-label]");
    if (label) label.textContent = editing ? "Done editing media" : "Edit page media";
  };

  const targetMeta = (img) => {
    if (!img || img.tagName !== "IMG") return null;
    if (img.hasAttribute("data-site-media")) {
      return { kind: "site", key: img.getAttribute("data-site-media"), img, label: "Site photo" };
    }
    const kind = img.getAttribute("data-editable-media");
    if (kind === "product") {
      return {
        kind: "product",
        productId: img.getAttribute("data-product-id") || "bulldogs-tee",
        colour: img.getAttribute("data-colour") || "orange",
        view: img.getAttribute("data-view") || "front",
        img,
        label: `${img.getAttribute("data-colour") || "orange"} ${img.getAttribute("data-view") || "front"}`,
      };
    }
    if (kind === "athlete") {
      return {
        kind: "athlete",
        athleteId: img.getAttribute("data-athlete-id"),
        img,
        label: img.getAttribute("alt") || "Athlete photo",
      };
    }
    if (kind === "event") {
      return {
        kind: "event",
        eventId: img.getAttribute("data-event-id"),
        img,
        label: "Event cover",
      };
    }
    return null;
  };

  const markHits = () => {
    document.querySelectorAll(IMG_SELECTOR).forEach((img) => {
      const wrap = img.parentElement;
      if (!wrap) return;
      wrap.classList.add("media-edit-hit");
    });
  };

  const clearHits = () => {
    document.querySelectorAll(".media-edit-hit").forEach((el) => el.classList.remove("media-edit-hit"));
  };

  const applyLocalSrc = (meta, url) => {
    meta.img.src = url;
    if (meta.kind === "site" && window.BULLDOGS_SITE_MEDIA && meta.key) {
      window.BULLDOGS_SITE_MEDIA[meta.key] = url;
    }
    if (meta.kind === "product") {
      const product = meta.img.closest(".product");
      if (product) {
        product.setAttribute(`data-${meta.view}-${meta.colour}`, url);
        if (meta.view === "front" && product.getAttribute("data-colour") === meta.colour) {
          product.setAttribute("data-image", url);
        }
        product.querySelector(`[data-shot="${meta.colour}:${meta.view}"] img`)?.setAttribute("src", url);
      }
    }
    if (meta.kind === "event" && meta.eventId) {
      document
        .querySelectorAll(`img[data-editable-media="event"][data-event-id="${CSS.escape(meta.eventId)}"]`)
        .forEach((img) => {
          img.src = url;
        });
    }
    if (meta.kind === "athlete" && meta.athleteId) {
      document
        .querySelectorAll(`img[data-editable-media="athlete"][data-athlete-id="${CSS.escape(meta.athleteId)}"]`)
        .forEach((img) => {
          img.src = url;
        });
    }
  };

  const setDockView = (which) => {
    showingNew = which !== "old";
    const dock = ensureDock();
    dock.querySelectorAll("[data-media-dock-view]").forEach((btn) => {
      btn.classList.toggle("is-active", btn.dataset.mediaDockView === (showingNew ? "new" : "old"));
    });
    if (!pending) return;
    applyLocalSrc(pending.meta, showingNew ? previewUrl : pending.originalSrc);
  };

  const closeDock = ({ revert = false } = {}) => {
    const dock = ensureDock();
    dock.hidden = true;
    document.body.classList.remove("has-media-edit-dock");
    if (pending && revert) applyLocalSrc(pending.meta, pending.originalSrc);
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      previewUrl = null;
    }
    pending = null;
    showingNew = true;
    const status = dock.querySelector("[data-media-dock-status]");
    if (status) {
      status.textContent = "";
      status.classList.remove("is-error");
    }
    const confirm = dock.querySelector("[data-media-dock-confirm]");
    if (confirm) confirm.disabled = false;
  };

  const openDock = (meta, file) => {
    if (pending) closeDock({ revert: true });
    const originalSrc = meta.img.currentSrc || meta.img.src;
    previewUrl = URL.createObjectURL(file);
    pending = { meta, file, originalSrc };
    applyLocalSrc(meta, previewUrl);
    const dock = ensureDock();
    dock.querySelector("[data-media-dock-label]").textContent = meta.label || "Photo change";
    const status = dock.querySelector("[data-media-dock-status]");
    if (status) {
      status.textContent = "";
      status.classList.remove("is-error");
    }
    setDockView("new");
    dock.hidden = false;
    document.body.classList.add("has-media-edit-dock");
  };

  const setEditing = (on) => {
    editing = Boolean(on) && admin;
    document.body.classList.toggle("is-media-editing", editing);
    syncMenuItem();
    if (editing) markHits();
    else {
      clearHits();
      if (pending) closeDock({ revert: true });
    }
  };

  const savePending = async () => {
    if (!pending || !media()?.uploadMedia || !api()) return;
    const dock = ensureDock();
    const status = dock.querySelector("[data-media-dock-status]");
    const confirm = dock.querySelector("[data-media-dock-confirm]");
    const { meta, file } = pending;
    try {
      if (confirm) confirm.disabled = true;
      if (status) {
        status.textContent = "Saving…";
        status.classList.remove("is-error");
      }
      const folder =
        meta.kind === "site" ? "site" : meta.kind === "product" ? "products" : meta.kind === "athlete" ? "athletes" : "events";
      const url = await media().uploadMedia(folder, file);
      if (meta.kind === "site") {
        await api().fn("club-api", { action: "set_site_media", key: meta.key, url });
      } else if (meta.kind === "product") {
        const { product } = await api().fn("club-api", {
          action: "get_product_images",
          product_id: meta.productId,
        });
        const images = JSON.parse(JSON.stringify(product?.images || {}));
        if (!images[meta.colour]) images[meta.colour] = {};
        images[meta.colour][meta.view] = url;
        await api().fn("club-api", {
          action: "set_product_images",
          product_id: meta.productId,
          images,
        });
      } else if (meta.kind === "athlete") {
        if (!meta.athleteId) throw new Error("Missing athlete");
        await api().fn("club-api", {
          action: "set_athlete_image",
          athlete_id: meta.athleteId,
          image_url: url,
        });
      } else if (meta.kind === "event") {
        if (!meta.eventId) throw new Error("Missing event");
        await api().fn("club-api", {
          action: "set_event_cover",
          event_id: meta.eventId,
          cover_image: url,
        });
      } else {
        throw new Error("Unknown media target");
      }
      applyLocalSrc(meta, url);
      closeDock({ revert: false });
    } catch (err) {
      if (status) {
        status.textContent = err.message || "Couldn't save that photo";
        status.classList.add("is-error");
      }
      if (confirm) confirm.disabled = false;
    }
  };

  const beginReplace = (meta) => {
    if (!meta || !editing || pending) return;
    const input = ensureFileInput();
    input.value = "";
    input.onchange = () => {
      const file = input.files?.[0];
      input.value = "";
      if (!file) return;
      openDock(meta, file);
    };
    input.click();
  };

  const findEditableImg = (event) => {
    const direct = event.target.closest?.(IMG_SELECTOR);
    if (direct) return direct;
    const hit = event.target.closest?.(".media-edit-hit");
    return hit?.querySelector?.(IMG_SELECTOR) || null;
  };

  document.addEventListener("click", (event) => {
    const toggle = event.target.closest("[data-media-edit-toggle]");
    if (toggle) {
      event.preventDefault();
      setEditing(!editing);
      window.BULLDOGS_AUTH?.closeMenu?.();
      return;
    }
    if (event.target.closest("[data-media-dock-cancel]")) {
      event.preventDefault();
      closeDock({ revert: true });
      return;
    }
    if (event.target.closest("[data-media-dock-confirm]")) {
      event.preventDefault();
      savePending();
      return;
    }
    const view = event.target.closest("[data-media-dock-view]");
    if (view) {
      event.preventDefault();
      setDockView(view.dataset.mediaDockView);
      return;
    }
    if (!editing || pending) return;
    const img = findEditableImg(event);
    const meta = targetMeta(img);
    if (!meta) return;
    event.preventDefault();
    event.stopPropagation();
    beginReplace(meta);
  });

  const setAdmin = (isAdmin) => {
    admin = Boolean(isAdmin);
    if (!admin && editing) setEditing(false);
    else syncMenuItem();
  };

  const refreshAdmin = async () => {
    const session = window.BULLDOGS_SESSION;
    if (!session) {
      setAdmin(false);
      return;
    }
    if (window.BULLDOGS_PROFILE?.is_admin != null) {
      setAdmin(Boolean(window.BULLDOGS_PROFILE.is_admin));
      return;
    }
    try {
      const profile = await api()?.fn("me-api", { action: "profile" });
      window.BULLDOGS_PROFILE = profile;
      setAdmin(Boolean(profile?.is_admin));
    } catch {
      setAdmin(false);
    }
  };

  const boot = () => {
    ensureDock();
    ensureFileInput();
    refreshAdmin();
    window.BULLDOGS_SB?.auth?.onAuthStateChange?.(() => {
      setTimeout(refreshAdmin, 50);
    });
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();

  window.BULLDOGS_MEDIA_EDIT = {
    // Call after dynamic lists paint (home/team/events/shop already do this).
    refresh: () => {
      if (editing) markHits();
      syncMenuItem();
      refreshAdmin();
    },
    setEditing,
    isEditing: () => editing,
    setAdmin,
  };
})();
