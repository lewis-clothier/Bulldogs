(() => {
  const STORAGE_KEY = "bulldogs-cart";
  const cfg = window.BULLDOGS || {};
  const api = window.BULLDOGS_API;

  const colourKey = (value) => {
    const raw = String(value || "").toLowerCase();
    if (raw.includes("blue")) return "blue";
    if (raw.includes("orange")) return "orange";
    return raw.replace(/\s+print$/i, "").trim() || "orange";
  };

  const normalizeCart = (items) => {
    if (!Array.isArray(items)) return [];
    return items
      .filter((item) => item && typeof item === "object")
      .map((item) => {
        const colour = colourKey(item.colour);
        return {
          ...item,
          product_id: item.product_id || "bulldogs-tee",
          colour,
          colourLabel: item.colourLabel || `${colour.charAt(0).toUpperCase()}${colour.slice(1)} print`,
          size: String(item.size || "").toUpperCase(),
          qty: Math.max(1, Number(item.qty) || 1),
        };
      });
  };

  const getCart = () => {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      const cart = normalizeCart(parsed);
      if (JSON.stringify(cart) !== JSON.stringify(parsed)) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(cart));
      }
      return cart;
    } catch {
      return [];
    }
  };

  const formatPrice = (n) => `£${Number(n).toFixed(0)}`;
  const moneyPence = (pence) => `£${(pence / 100).toFixed(pence % 100 ? 2 : 0)}`;

  const cartCountEls = () => document.querySelectorAll(".cart-btn__count");
  const cartBody = document.querySelector(".cart-drawer__body");
  const cartTotal = document.querySelector(".cart-total strong");
  const overlay = document.querySelector(".cart-overlay");
  const drawer = document.querySelector(".cart-drawer");
  if (!document.querySelector("[data-checkout-dialog]")) {
    document.body.insertAdjacentHTML(
      "beforeend",
      `<dialog class="booking-dialog" data-checkout-dialog>
        <button class="booking-dialog__close" type="button" data-close-checkout aria-label="Close">×</button>
        <form class="contact-form" data-checkout-form>
          <header class="booking-dialog__head">
            <p class="eyebrow">Checkout</p>
            <h2>Delivery details</h2>
            <p class="muted">You’ll add your address on the next screen. In-stock tees ship from what we have. A new print is typically 2–3 weeks.</p>
          </header>
          <div class="field">
            <label for="checkout_full_name">Your name</label>
            <input id="checkout_full_name" name="full_name" type="text" autocomplete="name" maxlength="200" />
          </div>
          <div class="field">
            <label for="checkout_email">Email</label>
            <input id="checkout_email" name="email" type="email" required autocomplete="email" maxlength="254" />
          </div>
          <label class="field field--check">
            <input type="checkbox" name="newsletter_opt_in" />
            <span>Email me about future Bulldogs events and drops</span>
          </label>
          <p class="muted">By paying you agree to the <a href="shop-policy.html">shop policy</a> and <a href="terms.html">terms</a>.</p>
          <div class="auth-checkout" data-auth-checkout>
            <div data-auth-logged-in hidden>
              <p class="muted">Paying as <strong data-auth-as></strong></p>
              <button class="btn btn--ghost" type="button" data-auth-out>Not you? Sign out</button>
              <button class="btn btn--accent btn--block" type="submit">Continue to payment</button>
            </div>
            <div data-auth-guest>
              <button class="btn btn--accent btn--block" type="submit" data-checkout-guest>Checkout as guest</button>
              <p class="auth-checkout__alt">
                <button class="text-btn" type="button" data-open-auth>Sign in</button>
                ·
                <button class="text-btn" type="button" data-open-auth="signup">Create account</button>
              </p>
            </div>
          </div>
          <p class="form-status" role="status"></p>
        </form>
      </dialog>`,
    );
  }

  document.querySelectorAll(".cart-drawer__foot .btn").forEach((btn) => {
    btn.disabled = false;
    btn.removeAttribute("disabled");
    btn.dataset.checkout = "";
    btn.textContent = "Checkout";
  });

  const checkoutBtn = document.querySelector("[data-checkout]");
  const checkoutDialog = document.querySelector("[data-checkout-dialog]");
  const checkoutForm = document.querySelector("[data-checkout-form]");

  window.BULLDOGS_AUTH?.bindCheckout(checkoutForm?.querySelector("[data-auth-checkout]"));

  const openCart = () => {
    overlay?.classList.add("is-open");
    drawer?.classList.add("is-open");
    document.body.style.overflow = "hidden";
  };

  const closeCart = () => {
    overlay?.classList.remove("is-open");
    drawer?.classList.remove("is-open");
    if (!document.querySelector(".nav__links.is-open")) document.body.style.overflow = "";
  };

  const saveCart = (cart) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cart));
    renderCart();
    const session = window.BULLDOGS_SESSION;
    if (session && api) {
      api.fn("me-api", { action: "save_cart", items: cart }).catch(() => {});
    }
  };

  let catalogCache = [];
  const shippingPence = Number(cfg.shippingPence || 0);

  const applyStock = (product) => {
    const id = product.getAttribute("data-product-id");
    const row = catalogCache.find((item) => item.id === id);
    const select = product.querySelector("select[data-size]");
    const sizeInput = product.querySelector("input[data-size]");
    const sizeButtons = [...product.querySelectorAll("[data-size-option]")];
    const add = product.querySelector("[data-add]");
    if (!row) return;
    const colour = product.getAttribute("data-colour") || "orange";
    const variants = row.variants || [];
    const availableFor = (size) => {
      const match = variants.find((v) => v.colour === colour && v.size === size);
      return match ? Number(match.available) : 0;
    };
    const labelAdd = (soldOut) => {
      if (!add) return;
      add.disabled = soldOut;
      const price = product.getAttribute("data-price") || "";
      add.textContent = soldOut ? "Sold out" : `Add to bag · £${price}`;
    };
    const paintStock = (size) => {
      const note = product.querySelector("[data-stock-note]");
      if (!note || !size) return;
      const available = availableFor(size);
      note.hidden = available <= 0;
      note.textContent = available === 1 ? "1 in stock" : available > 1 ? `${available} in stock` : "";
    };
    if (select) {
      [...select.options].forEach((opt) => {
        const size = opt.value || opt.textContent.trim();
        const available = availableFor(size);
        opt.disabled = available <= 0;
        opt.textContent = available <= 0 ? `${size} — sold out` : size;
      });
      if (select.selectedOptions[0]?.disabled) {
        const first = [...select.options].find((opt) => !opt.disabled);
        if (first) select.value = first.value;
      }
      if (add) add.disabled = [...select.options].every((opt) => opt.disabled);
      paintStock(select.value);
      return;
    }
    if (!sizeButtons.length || !sizeInput) return;
    sizeButtons.forEach((btn) => {
      const available = availableFor(btn.getAttribute("data-size-option"));
      btn.disabled = available <= 0;
      btn.classList.toggle("is-off", available <= 0);
    });
    const current = sizeButtons.find((btn) => btn.getAttribute("data-size-option") === sizeInput.value);
    if (!current || current.disabled) {
      const first = sizeButtons.find((btn) => !btn.disabled);
      if (first) sizeInput.value = first.getAttribute("data-size-option");
    }
    sizeButtons.forEach((btn) => {
      btn.classList.toggle("is-on", btn.getAttribute("data-size-option") === sizeInput.value && !btn.disabled);
    });
    labelAdd(sizeButtons.every((btn) => btn.disabled));
    paintStock(sizeInput.value);
  };

  const renderCart = () => {
    const cart = getCart();
    const count = cart.reduce((sum, item) => sum + item.qty, 0);
    const total = cart.reduce((sum, item) => sum + item.price * item.qty, 0);
    const ship = cart.length && shippingPence ? shippingPence / 100 : 0;

    cartCountEls().forEach((el) => {
      el.textContent = String(count);
      el.dataset.count = String(count);
    });

    if (cartTotal) cartTotal.textContent = formatPrice(total + ship);
    if (checkoutBtn) {
      checkoutBtn.disabled = !cart.length;
      checkoutBtn.textContent = cart.length ? "Checkout" : "Checkout";
    }
    const note = document.querySelector(".cart-note");
    if (note) {
      note.textContent = shippingPence
        ? `UK delivery ${moneyPence(shippingPence)}. In-stock tees ship from what we have. A new print is typically 2–3 weeks.`
        : "In-stock tees ship from what we have. A new print is typically 2–3 weeks.";
    }

    if (!cartBody) return;
    if (!cart.length) {
      cartBody.innerHTML = `<p class="cart-empty">Your bag is empty. Grab some pack gear.</p>`;
      return;
    }
    cartBody.innerHTML = cart
      .map((item, i) => {
        const detail = [item.colourLabel, item.size ? `Size ${item.size}` : "", formatPrice(item.price)].filter(Boolean).join(" · ");
        return `
      <article class="cart-item" data-index="${i}">
        <img src="${item.image}" alt="" />
        <div>
          <h4>${item.name}</h4>
          <p>${detail}</p>
          <div class="cart-item__actions">
            <div class="cart-item__qty">
              <button type="button" data-cart-qty="-1" data-line="${i}" aria-label="Fewer" ${item.qty <= 1 ? "disabled" : ""}>−</button>
              <input data-line-qty="${i}" type="number" min="1" max="10" value="${item.qty}" inputmode="numeric" aria-label="Quantity" />
              <button type="button" data-cart-qty="1" data-line="${i}" aria-label="More" ${item.qty >= 10 ? "disabled" : ""}>+</button>
            </div>
            <button type="button" class="cart-item__remove" data-remove="${i}">Remove</button>
          </div>
        </div>
        <span>${formatPrice(item.price * item.qty)}</span>
      </article>`;
      })
      .join("");
  };

  const setLineQty = (index, raw) => {
    const cart = getCart();
    const item = cart[index];
    if (!item) return;
    const next = Math.min(10, Math.max(1, Math.round(Number(raw))));
    if (!Number.isFinite(next) || next === item.qty) {
      renderCart();
      return;
    }
    item.qty = next;
    saveCart(cart);
  };

  document.querySelectorAll("[data-open-cart]").forEach((btn) => btn.addEventListener("click", openCart));
  document.querySelectorAll("[data-close-cart]").forEach((btn) => btn.addEventListener("click", closeCart));
  overlay?.addEventListener("click", closeCart);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeCart();
  });

  cartBody?.addEventListener("click", (e) => {
    const remove = e.target.closest("[data-remove]");
    if (remove) {
      const cart = getCart();
      cart.splice(Number(remove.dataset.remove), 1);
      saveCart(cart);
      return;
    }
    const step = e.target.closest("[data-cart-qty]");
    if (!step || step.disabled) return;
    setLineQty(Number(step.dataset.line), getCart()[Number(step.dataset.line)]?.qty + Number(step.dataset.cartQty));
  });

  cartBody?.addEventListener("change", (e) => {
    const input = e.target.closest("[data-line-qty]");
    if (!input) return;
    setLineQty(Number(input.dataset.lineQty), input.value);
  });

  const syncProductImage = (product) => {
    const colour = product.getAttribute("data-colour") || "orange";
    const frontSrc = product.getAttribute(`data-front-${colour}`);
    const backSrc = product.getAttribute(`data-back-${colour}`);
    const frontImg = product.querySelector(".product__img--front");
    const backImg = product.querySelector(".product__img--back");
    const singleImg = product.querySelector(".product__img:not(.product__img--back)");
    if (frontImg && frontSrc) {
      frontImg.src = frontSrc;
      frontImg.alt = `Bulldogs Tee — ${colour} print`;
    } else if (singleImg && frontSrc) {
      singleImg.src = frontSrc;
      singleImg.alt = `Bulldogs Tee — ${colour} print`;
    }
    if (backImg && backSrc) backImg.src = backSrc;
    if (frontSrc) product.setAttribute("data-image", frontSrc);
    const label = product.querySelector("[data-colour-label]");
    if (label) label.textContent = colour === "blue" ? "Blue" : "Orange";
  };

  const syncShots = (product) => {
    const colour = product.getAttribute("data-colour") || "orange";
    const back = product.querySelector(".product__media--swap")?.classList.contains("is-showing-back");
    const shot = `${colour}:${back ? "back" : "front"}`;
    product.querySelectorAll("[data-shot]").forEach((btn) => {
      btn.classList.toggle("is-on", btn.getAttribute("data-shot") === shot);
    });
  };

  const applyColour = (product, colour) => {
    if (colour !== "blue" && colour !== "orange") return;
    product.setAttribute("data-colour", colour);
    product.querySelectorAll("[data-colour]").forEach((btn) => {
      btn.classList.toggle("is-active", btn.getAttribute("data-colour") === colour);
    });
    syncProductImage(product);
    applyStock(product);
    syncShots(product);
  };

  const applyView = (product, view) => {
    const side = view === "back" ? "back" : "front";
    product.querySelector(".product__media--swap")?.classList.toggle("is-showing-back", side === "back");
    product.querySelectorAll("[data-view]").forEach((btn) => {
      btn.classList.toggle("is-active", btn.getAttribute("data-view") === side);
    });
    syncShots(product);
  };

  const params = new URLSearchParams(window.location.search);
  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const orderState = params.get("order") || hashParams.get("order");
  const storedColour = sessionStorage.getItem("bulldogs-shop-colour");
  if (storedColour) sessionStorage.removeItem("bulldogs-shop-colour");
  const urlColour = (params.get("colour") || params.get("color") || storedColour || "").toLowerCase();
  const clearBoughtCart = () => {
    try {
      localStorage.removeItem(STORAGE_KEY);
      sessionStorage.setItem("bulldogs-cart-cleared", "1");
    } catch {
      /* ignore */
    }
    renderCart();
    if (window.BULLDOGS_SESSION && api) {
      api.fn("me-api", { action: "save_cart", items: [] }).catch(() => {});
    }
  };
  if (orderState === "success" || sessionStorage.getItem("bulldogs-cart-cleared") === "1") {
    clearBoughtCart();
    const banner = document.querySelector("[data-shop-banner]");
    if (orderState === "success" && banner) {
      banner.hidden = false;
      banner.textContent = "Order received. Check your email — we’ll place the print order next.";
      banner.classList.remove("is-error");
    }
  } else if (orderState === "cancelled") {
    const banner = document.querySelector("[data-shop-banner]");
    if (banner) {
      banner.hidden = false;
      banner.textContent = "Payment was cancelled. Nothing was charged.";
      banner.classList.add("is-error");
    }
  }

  document.querySelectorAll("[data-shop-colour]").forEach((link) => {
    link.addEventListener("click", () => {
      const colour = link.getAttribute("data-shop-colour");
      if (colour === "blue" || colour === "orange") sessionStorage.setItem("bulldogs-shop-colour", colour);
    });
  });

  document.querySelectorAll(".product").forEach((product) => {
    applyColour(product, urlColour === "blue" || urlColour === "orange" ? urlColour : "orange");
    applyView(product, "front");
    product.querySelectorAll("[data-colour]").forEach((btn) => {
      btn.addEventListener("click", () => applyColour(product, btn.getAttribute("data-colour")));
    });
    product.querySelectorAll("[data-view]").forEach((btn) => {
      btn.addEventListener("click", () => applyView(product, btn.getAttribute("data-view")));
    });
    product.querySelector('a[href="#size-guide"]')?.addEventListener("click", (event) => {
      const details = document.getElementById("size-guide");
      if (!details) return;
      event.preventDefault();
      details.open = true;
      details.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
    product.querySelectorAll("[data-shot]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const [colour, view] = (btn.getAttribute("data-shot") || "").split(":");
        applyColour(product, colour);
        applyView(product, view);
      });
    });
    product.querySelectorAll("[data-size-option]").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (btn.disabled) return;
        const input = product.querySelector("input[data-size]");
        if (input) input.value = btn.getAttribute("data-size-option");
        applyStock(product);
      });
    });
    product.querySelectorAll("[data-qty-delta]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const input = product.querySelector("[data-qty]");
        if (!input) return;
        const next = Math.min(10, Math.max(1, Number(input.value) + Number(btn.getAttribute("data-qty-delta"))));
        input.value = String(next);
      });
    });

    const media = product.querySelector(".product__media--swap");
    if (media) {
      const SWIPE_MIN = 40;
      let swipePointer = null;
      let swipeStartX = 0;
      let swipeStartY = 0;
      media.addEventListener("pointerdown", (e) => {
        if (e.button != null && e.button !== 0) return;
        swipePointer = e.pointerId;
        swipeStartX = e.clientX;
        swipeStartY = e.clientY;
        media.setPointerCapture?.(e.pointerId);
      });
      const endSwipe = (e) => {
        if (swipePointer == null || e.pointerId !== swipePointer) return;
        swipePointer = null;
        const dx = e.clientX - swipeStartX;
        const dy = e.clientY - swipeStartY;
        if (Math.abs(dx) < SWIPE_MIN || Math.abs(dx) < Math.abs(dy)) return;
        const showingBack = media.classList.contains("is-showing-back");
        if (dx < 0 && !showingBack) applyView(product, "back");
        else if (dx > 0 && showingBack) applyView(product, "front");
      };
      media.addEventListener("pointerup", endSwipe);
      media.addEventListener("pointercancel", () => {
        swipePointer = null;
      });
    }

    product.querySelector("[data-add]")?.addEventListener("click", () => {
      const addBtn = product.querySelector("[data-add]");
      if (addBtn?.disabled) return;
      const name = product.getAttribute("data-name");
      const productId = product.getAttribute("data-product-id") || "bulldogs-tee";
      const price = Number(product.getAttribute("data-price"));
      const colour = product.getAttribute("data-colour") || "orange";
      const colourLabel = `${colour.charAt(0).toUpperCase()}${colour.slice(1)} print`;
      const image =
        product.getAttribute(`data-front-${colour}`) ||
        product.getAttribute("data-image") ||
        product.querySelector(".product__img--front")?.src;
      const size = product.querySelector("[data-size], select")?.value || "";
      const qty = Math.max(1, Number(product.querySelector("[data-qty]")?.value) || 1);
      const cart = getCart();
      const existing = cart.find((item) => item.product_id === productId && item.size === size && item.colour === colour);
      if (existing) existing.qty += qty;
      else cart.push({ product_id: productId, name, price, image, size, colour, colourLabel, qty });
      saveCart(cart);
      openCart();
    });
  });

  checkoutBtn?.addEventListener("click", () => {
    if (!getCart().length) return;
    const session = window.BULLDOGS_SESSION;
    if (session?.user && checkoutForm) {
      if (checkoutForm.email) checkoutForm.email.value = session.user.email;
      if (checkoutForm.full_name && session.user.user_metadata?.full_name) {
        checkoutForm.full_name.value = session.user.user_metadata.full_name;
      }
    }
    closeCart();
    checkoutDialog?.showModal();
  });

  checkoutDialog?.querySelectorAll("[data-close-checkout]").forEach((btn) => {
    btn.addEventListener("click", () => checkoutDialog.close());
  });

  checkoutForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!api) return;
    const status = checkoutForm.querySelector(".form-status");
    const submitBtns = [...checkoutForm.querySelectorAll('[type="submit"]')];
    const data = new FormData(checkoutForm);
    const cart = getCart();
    status.textContent = "Starting checkout…";
    status.classList.remove("is-error");
    submitBtns.forEach((btn) => {
      btn.disabled = true;
    });
    try {
      const payload = await api.fn("create-shop-checkout", {
        email: data.get("email"),
        full_name: data.get("full_name") || null,
        newsletter_opt_in: data.get("newsletter_opt_in") === "on",
        items: normalizeCart(cart).map((item) => ({
          product_id: item.product_id || "bulldogs-tee",
          colour: colourKey(item.colour),
          size: String(item.size || "").toUpperCase(),
          quantity: item.qty,
        })),
      });
      if (!payload.url) throw new Error("Couldn't start checkout");
      window.location.assign(payload.url);
    } catch (err) {
      status.textContent = err.message || "Couldn't start checkout.";
      status.classList.add("is-error");
      submitBtns.forEach((btn) => {
        btn.disabled = false;
      });
    }
  });

  const mergeAccountCart = async () => {
    if (!api || !window.BULLDOGS_SESSION) return;
    if (sessionStorage.getItem("bulldogs-cart-cleared") === "1") {
      clearBoughtCart();
      try {
        sessionStorage.removeItem("bulldogs-cart-cleared");
      } catch {
        /* ignore */
      }
      return;
    }
    try {
      const remote = await api.fn("me-api", { action: "get_cart" });
      const local = getCart();
      if ((!local.length) && Array.isArray(remote.items) && remote.items.length) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeCart(remote.items)));
        renderCart();
      } else if (local.length) {
        await api.fn("me-api", { action: "save_cart", items: local });
      }
    } catch {
      /* guest */
    }
  };

  if (api) {
    api.rpc("list_shop_catalog").then((catalog) => {
      catalogCache = catalog || [];
      document.querySelectorAll(".product[data-product-id]").forEach((product) => {
        const id = product.getAttribute("data-product-id");
        const row = catalogCache.find((item) => item.id === id);
        if (!row) return;
        product.setAttribute("data-price", String(row.price_pence / 100));
        applyStock(product);
      });
    }).catch(() => {});
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) mergeAccountCart();
    });
    setTimeout(mergeAccountCart, 800);
  } else {
    setTimeout(() => {
      try {
        sessionStorage.removeItem("bulldogs-cart-cleared");
      } catch {
        /* ignore */
      }
    }, 900);
  }

  renderCart();
})();
