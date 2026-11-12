(() => {
  const root = document.querySelector("[data-orders]");
  const auth = window.BULLDOGS_AUTH;
  const api = window.BULLDOGS_API;
  if (!root || !auth || !api) return;

  const escapeHtml = (value) =>
    String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  const bought = new Set(["paid", "fulfilled", "refunded"]);

  const labels = {
    paid: "Paid",
    fulfilled: "Fulfilled",
    refunded: "Refunded",
  };

  const when = (iso) =>
    new Intl.DateTimeFormat("en-GB", {
      dateStyle: "full",
      timeZone: "Europe/London",
    }).format(new Date(iso));

  const money = (pence) => {
    const pounds = Number(pence || 0) / 100;
    return Number.isInteger(pounds) ? `£${pounds}` : `£${pounds.toFixed(2)}`;
  };

  const itemLine = (item) => {
    const colour = item.colour ? `${item.colour.charAt(0).toUpperCase()}${item.colour.slice(1)} print` : "";
    return [colour, item.size ? `Size ${item.size}` : "", `× ${item.quantity}`].filter(Boolean).join(" · ");
  };

  const productImage = (item) => {
    const id = item.product_id || "";
    const name = String(item.product_name || "").toLowerCase();
    const colour = String(item.colour || "").toLowerCase();
    if (id === "bulldogs-tee" || name.includes("tee")) {
      if (colour === "blue") return "assets/products/product_1_blue_front_cutout.png";
      if (colour === "orange") return "assets/products/product_1_orange_front_cutout.png";
    }
    return "";
  };

  let seq = 0;

  const signedOut = () => {
    root.innerHTML = `<p class="muted">Sign in to see the orders on this account.</p>
      <p><button class="btn btn--accent" type="button" data-open-auth="signin">Sign in</button></p>`;
  };

  const paint = (orders) => {
    if (!orders.length) {
      root.innerHTML = `<p class="muted">No orders yet.</p><p><a class="btn btn--ghost" href="shop.html">Shop</a></p>`;
      return;
    }
    root.innerHTML = `<div class="booking-list">${orders
      .map((order) => {
        const items = order.items || [];
        const shipping = Number(order.amount_shipping_pence || 0);
        const dated = order.paid_at || order.created_at;
        const delivery = shipping
          ? `<li class="order-card__line--delivery"><div><strong>Delivery</strong></div><b class="order-card__price">${escapeHtml(money(shipping))}</b></li>`
          : "";
        return `<article class="booking-card order-card">
          <div class="order-card__head">
            <span>
              <span class="booking-card__title">${escapeHtml(dated ? when(dated) : "Order")}</span>
              <span class="booking-card__when">${escapeHtml(labels[order.status] || order.status)}</span>
            </span>
          </div>
          <ul class="order-card__items">
            ${items
              .map((item) => {
                const src = productImage(item);
                const colour = String(item.colour || "").toLowerCase();
                const shot = src
                  ? `<span class="order-card__shot${colour === "blue" ? " order-card__shot--blue" : ""}"><img src="${escapeHtml(src)}" alt="" /></span>`
                  : "";
                const price = Number(item.unit_price_pence || 0) * Number(item.quantity || 1);
                return `<li${src ? "" : ` class="order-card__line--plain"`}>
                  ${shot}
                  <div>
                    <strong>${escapeHtml(item.product_name || "Item")}</strong>
                    <span>${escapeHtml(itemLine(item))}</span>
                  </div>
                  <b class="order-card__price">${escapeHtml(money(price))}</b>
                </li>`;
              })
              .join("")}
            ${delivery}
          </ul>
        </article>`;
      })
      .join("")}</div>`;
  };

  const load = async (session) => {
    const mine = ++seq;
    window.BULLDOGS_SESSION = session || null;
    if (!session) {
      signedOut();
      return;
    }
    root.innerHTML = `<p class="muted">Loading orders…</p>`;
    try {
      const payload = await api.fn("me-api", { action: "orders" });
      if (mine !== seq) return;
      const orders = (payload.orders || []).filter((order) => bought.has(order.status) && (order.items || []).length);
      paint(orders);
    } catch (err) {
      if (mine !== seq) return;
      root.innerHTML = `<p>${escapeHtml(err.message || "Couldn't load orders.")}</p>`;
    }
  };

  auth
    .whenReady()
    .then((sb) => {
      sb.auth.onAuthStateChange((_event, session) => load(session));
      sb.auth.getSession().then(({ data }) => load(data.session));
    })
    .catch((err) => {
      root.innerHTML = `<p>${escapeHtml(err.message)}</p>`;
    });
})();
