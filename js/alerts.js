(() => {
  const api = window.BULLDOGS_API;
  const signedInEmail = () => window.BULLDOGS_SESSION?.user?.email || "";
  let alertsOn = false;
  let dialog = document.querySelector("[data-alerts-dialog]");

  const unavailable = (err, fallback) =>
    /unknown action/i.test(err?.message || "") ? fallback : err?.message || fallback;

  const openButtons = () => [...document.querySelectorAll("[data-alerts-open]")];

  const ensureDialog = () => {
    if (dialog) return dialog;
    const host = document.createElement("div");
    host.innerHTML = `
    <dialog class="booking-dialog" data-alerts-dialog>
      <button class="booking-dialog__close" type="button" data-close-alerts aria-label="Close">×</button>
      <form class="contact-form" data-alerts-form>
        <header class="booking-dialog__head">
          <p class="eyebrow">Alerts</p>
          <h2 data-alerts-heading>Turn on alerts</h2>
          <p class="muted" data-alerts-lede>Get emailed when new events go live.</p>
        </header>
        <div data-alerts-guest>
          <div class="field">
            <label for="alerts-email">Email</label>
            <input id="alerts-email" name="email" type="email" required maxlength="254" autocomplete="email" placeholder="you@example.com" />
          </div>
          <button class="btn btn--accent btn--block" type="submit">Turn on alerts</button>
          <p class="muted" data-alerts-or>or</p>
          <button class="btn btn--ghost btn--block" type="button" data-alerts-auth>Sign in or register</button>
        </div>
        <div data-alerts-member hidden>
          <p data-alerts-explain>
            We’ll email you as soon as a new event is published on the site — with the title, date, place, and a link to book on the events page.
          </p>
          <div class="confirm-dialog__acts">
            <button class="btn btn--ghost" type="button" data-close-alerts>Cancel</button>
            <button class="btn btn--accent" type="button" data-alerts-confirm>Turn on alerts</button>
          </div>
        </div>
        <div data-alerts-on hidden>
          <p data-alerts-off-explain>
            You’re set to get an email whenever a new event is published. Turn off alerts if you don’t want those anymore.
          </p>
          <div class="confirm-dialog__acts">
            <button class="btn btn--ghost" type="button" data-close-alerts>Cancel</button>
            <button class="btn btn--ghost" type="button" data-alerts-disable>Turn off alerts</button>
          </div>
        </div>
        <p class="form-status" role="status"></p>
      </form>
    </dialog>`;
    dialog = host.firstElementChild;
    document.body.appendChild(dialog);
    return dialog;
  };

  dialog = ensureDialog();
  const form = dialog.querySelector("[data-alerts-form]");

  const paintOpenButtons = () => {
    openButtons().forEach((btn) => {
      const style = btn.getAttribute("data-alerts-style") || "accent";
      btn.textContent = alertsOn ? "Alerts on" : "Turn on alerts";
      btn.classList.toggle("btn--ghost", alertsOn);
      if (style === "white") {
        btn.classList.toggle("btn--white", !alertsOn);
        btn.classList.toggle("btn--accent", false);
      } else {
        btn.classList.toggle("btn--accent", !alertsOn);
        btn.classList.toggle("btn--white", false);
      }
    });
  };

  const setAlertsPanel = (mode) => {
    const guest = dialog.querySelector("[data-alerts-guest]");
    const member = dialog.querySelector("[data-alerts-member]");
    const on = dialog.querySelector("[data-alerts-on]");
    const heading = dialog.querySelector("[data-alerts-heading]");
    const lede = dialog.querySelector("[data-alerts-lede]");
    const email = form?.querySelector('input[name="email"]');
    guest?.toggleAttribute("hidden", mode !== "guest");
    member?.toggleAttribute("hidden", mode !== "member");
    on?.toggleAttribute("hidden", mode !== "on");
    if (email) email.required = mode === "guest";
    if (heading) heading.textContent = mode === "on" ? "Turn off alerts" : "Turn on alerts";
    if (lede) {
      lede.textContent =
        mode === "on"
          ? "Stop emails about new events."
          : mode === "member"
            ? "Confirm and we’ll email you when something new goes live."
            : "Get emailed when new events go live.";
    }
    paintOpenButtons();
  };

  const refreshAlertsStatus = async () => {
    if (!signedInEmail() || !api) {
      alertsOn = false;
      return;
    }
    try {
      const profile = await api.fn("me-api", { action: "profile" });
      alertsOn = Boolean(profile?.newsletter);
    } catch {
      alertsOn = false;
    }
  };

  const paintAlerts = () => {
    if (!dialog.open) {
      paintOpenButtons();
      return;
    }
    if (alertsOn) setAlertsPanel("on");
    else if (signedInEmail()) setAlertsPanel("member");
    else setAlertsPanel("guest");
  };

  const openAlerts = (event) => {
    event?.preventDefault?.();
    const status = form?.querySelector(".form-status");
    if (status) {
      status.textContent = "";
      status.classList.remove("is-error");
    }
    dialog.showModal();
    paintAlerts();
    if (!signedInEmail()) form?.querySelector('input[name="email"]')?.focus();
    refreshAlertsStatus().then(paintAlerts);
  };

  window.BULLDOGS_AUTH?.whenReady()
    .then((sb) => {
      sb.auth.onAuthStateChange(() => {
        refreshAlertsStatus().then(paintAlerts);
      });
      refreshAlertsStatus().then(paintAlerts);
    })
    .catch(() => {});

  openButtons().forEach((btn) => btn.addEventListener("click", openAlerts));

  dialog.querySelectorAll("[data-close-alerts]").forEach((btn) => {
    btn.addEventListener("click", () => dialog.close());
  });
  window.BULLDOGS_AUTH?.backdropClose(dialog, () => dialog.close());
  dialog.querySelector("[data-alerts-auth]")?.addEventListener("click", () => {
    dialog.close();
    window.BULLDOGS_AUTH?.open({ mode: "signin" });
  });

  dialog.querySelector("[data-alerts-confirm]")?.addEventListener("click", async () => {
    const status = form?.querySelector(".form-status");
    const confirmBtn = dialog.querySelector("[data-alerts-confirm]");
    if (!status || !confirmBtn || !api) return;
    status.textContent = "Saving…";
    status.classList.remove("is-error");
    confirmBtn.disabled = true;
    try {
      await api.fn("me-api", { action: "subscribe_alerts" });
      alertsOn = true;
      status.textContent = "";
      dialog.close();
      paintAlerts();
    } catch (err) {
      status.textContent = unavailable(err, "Couldn't turn on alerts.");
      status.classList.add("is-error");
    } finally {
      confirmBtn.disabled = false;
    }
  });

  dialog.querySelector("[data-alerts-disable]")?.addEventListener("click", async () => {
    const status = form?.querySelector(".form-status");
    const disableBtn = dialog.querySelector("[data-alerts-disable]");
    if (!status || !disableBtn || !api) return;
    status.textContent = "Saving…";
    status.classList.remove("is-error");
    disableBtn.disabled = true;
    try {
      await api.fn("me-api", { action: "unsubscribe_alerts" });
      alertsOn = false;
      status.textContent = "";
      dialog.close();
      paintAlerts();
    } catch (err) {
      status.textContent = unavailable(err, "Couldn't turn off alerts.");
      status.classList.add("is-error");
    } finally {
      disableBtn.disabled = false;
    }
  });

  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (signedInEmail() || !api) return;
    const status = form.querySelector(".form-status");
    const submit = form.querySelector('[type="submit"]');
    status.textContent = "Saving…";
    status.classList.remove("is-error");
    submit.disabled = true;
    try {
      await api.fn("public-booking", {
        action: "subscribe_alerts",
        email: new FormData(form).get("email"),
      });
      form.reset();
      status.textContent = "You're on the list. We'll email you when a new event goes live.";
      paintAlerts();
    } catch (err) {
      status.textContent = unavailable(err, "Alerts aren't available yet.");
      status.classList.add("is-error");
    } finally {
      submit.disabled = false;
    }
  });

  if (window.location.hash === "#alerts") {
    openAlerts();
    history.replaceState(null, "", window.location.pathname + window.location.search);
  }
})();
