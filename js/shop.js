(() => {
  const STORAGE_KEY = "bulldogs-cart";

  const getCart = () => {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    } catch {
      return [];
    }
  };

  const saveCart = (cart) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cart));
    renderCart();
  };

  const formatPrice = (n) => `£${n.toFixed(0)}`;

  const cartCountEls = () => document.querySelectorAll(".cart-btn__count");
  const cartBody = document.querySelector(".cart-drawer__body");
  const cartTotal = document.querySelector(".cart-total strong");
  const overlay = document.querySelector(".cart-overlay");
  const drawer = document.querySelector(".cart-drawer");

  const openCart = () => {
    overlay?.classList.add("is-open");
    drawer?.classList.add("is-open");
    document.body.style.overflow = "hidden";
  };

  const closeCart = () => {
    overlay?.classList.remove("is-open");
    drawer?.classList.remove("is-open");
    if (!document.querySelector(".nav__links.is-open")) {
      document.body.style.overflow = "";
    }
  };

  const renderCart = () => {
    const cart = getCart();
    const count = cart.reduce((sum, item) => sum + item.qty, 0);
    const total = cart.reduce((sum, item) => sum + item.price * item.qty, 0);

    cartCountEls().forEach((el) => {
      el.textContent = String(count);
      el.dataset.count = String(count);
    });

    if (cartTotal) cartTotal.textContent = formatPrice(total);

    if (!cartBody) return;

    if (!cart.length) {
      cartBody.innerHTML = `<p class="cart-empty">Your bag is empty. Grab some pack gear.</p>`;
      return;
    }

    cartBody.innerHTML = cart
      .map(
        (item, i) => `
      <article class="cart-item" data-index="${i}">
        <img src="${item.image}" alt="" />
        <div>
          <h4>${item.name}</h4>
          <p>${[item.colour, item.size ? `Size ${item.size}` : ""].filter(Boolean).join(" · ")}${item.colour || item.size ? " · " : ""}${formatPrice(item.price)} × ${item.qty}</p>
          <button type="button" class="cart-item__remove" data-remove="${i}">Remove</button>
        </div>
        <span>${formatPrice(item.price * item.qty)}</span>
      </article>`
      )
      .join("");
  };

  document.querySelectorAll("[data-open-cart]").forEach((btn) => {
    btn.addEventListener("click", openCart);
  });

  document.querySelectorAll("[data-close-cart]").forEach((btn) => {
    btn.addEventListener("click", closeCart);
  });

  overlay?.addEventListener("click", closeCart);

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeCart();
  });

  cartBody?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-remove]");
    if (!btn) return;
    const index = Number(btn.dataset.remove);
    const cart = getCart();
    cart.splice(index, 1);
    saveCart(cart);
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

    if (backImg && backSrc) {
      backImg.src = backSrc;
    }

    if (frontSrc) {
      product.setAttribute("data-image", frontSrc);
    }

    const label = product.querySelector("[data-colour-label]");
    if (label) {
      label.textContent = colour === "blue" ? "Blue" : "Orange";
    }
  };

  const applyColour = (product, colour) => {
    if (colour !== "blue" && colour !== "orange") return;
    product.setAttribute("data-colour", colour);
    product.querySelectorAll("[data-colour]").forEach((btn) => {
      btn.classList.toggle("is-active", btn.getAttribute("data-colour") === colour);
    });
    syncProductImage(product);
  };

  const applyView = (product, view) => {
    const side = view === "back" ? "back" : "front";
    const media = product.querySelector(".product__media--swap");
    media?.classList.toggle("is-showing-back", side === "back");
    product.querySelectorAll("[data-view]").forEach((btn) => {
      btn.classList.toggle("is-active", btn.getAttribute("data-view") === side);
    });
  };

  const params = new URLSearchParams(window.location.search);
  const storedColour = sessionStorage.getItem("bulldogs-shop-colour");
  if (storedColour) sessionStorage.removeItem("bulldogs-shop-colour");
  const urlColour = (
    params.get("colour") ||
    params.get("color") ||
    storedColour ||
    ""
  ).toLowerCase();

  document.querySelectorAll("[data-shop-colour]").forEach((link) => {
    link.addEventListener("click", () => {
      const colour = link.getAttribute("data-shop-colour");
      if (colour === "blue" || colour === "orange") {
        sessionStorage.setItem("bulldogs-shop-colour", colour);
      }
    });
  });

  document.querySelectorAll(".product").forEach((product) => {
    applyColour(product, urlColour === "blue" || urlColour === "orange" ? urlColour : "orange");
    applyView(product, "front");

    product.querySelectorAll("[data-colour]").forEach((btn) => {
      btn.addEventListener("click", () => {
        applyColour(product, btn.getAttribute("data-colour"));
      });
    });

    product.querySelectorAll("[data-view]").forEach((btn) => {
      btn.addEventListener("click", () => {
        applyView(product, btn.getAttribute("data-view"));
      });
    });

    const addBtn = product.querySelector("[data-add]");
    if (!addBtn) return;

    addBtn.addEventListener("click", () => {
      const name = product.getAttribute("data-name");
      const price = Number(product.getAttribute("data-price"));
      const colour = product.getAttribute("data-colour") || "";
      const colourLabel = colour ? `${colour.charAt(0).toUpperCase()}${colour.slice(1)} print` : "";
      const image =
        product.getAttribute(`data-front-${colour}`) ||
        product.getAttribute("data-image") ||
        product.querySelector(".product__img--front")?.src ||
        product.querySelector(".product__img")?.src;
      const sizeSelect = product.querySelector("[data-size], select");
      const size = sizeSelect ? sizeSelect.value : "";
      const qtySelect = product.querySelector("[data-qty]");
      const qty = Math.max(1, Number(qtySelect?.value) || 1);

      const cart = getCart();
      const existing = cart.find(
        (item) => item.name === name && item.size === size && item.colour === colourLabel
      );
      if (existing) {
        existing.qty += qty;
      } else {
        cart.push({ name, price, image, size, colour: colourLabel, qty });
      }
      saveCart(cart);
      openCart();
    });
  });

  renderCart();
})();
