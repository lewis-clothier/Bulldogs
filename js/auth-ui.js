(() => {
  const cfg = () => window.BULLDOGS || {};
  const api = () => window.BULLDOGS_API;

  const whenReady = () =>
    new Promise((resolve, reject) => {
      let tries = 0;
      const tick = () => {
        if (window.BULLDOGS_SB) return resolve(window.BULLDOGS_SB);
        if (tries++ > 80) return reject(new Error("Auth isn’t ready. Refresh the page."));
        setTimeout(tick, 50);
      };
      tick();
    });

  let pendingNext = null;
  let menuOpen = false;
  let profileCache = null;

  const nextPath = () => {
    const next = new URLSearchParams(location.search).get("next");
    if (next && /^\w[\w./-]*\.html$/.test(next)) return next;
    return pendingNext;
  };

  const goNext = () => {
    const next = nextPath();
    pendingNext = null;
    if (next && !location.pathname.endsWith(next)) location.assign(next);
  };

  const loadGsi = () =>
    new Promise((resolve, reject) => {
      if (window.google?.accounts?.id) return resolve();
      const fail = () => reject(new Error("Couldn't load Google sign-in."));
      const ready = () => (window.google?.accounts?.id ? resolve() : fail());
      const existing = document.querySelector('script[src="https://accounts.google.com/gsi/client"]');
      if (existing) {
        existing.addEventListener("load", ready);
        existing.addEventListener("error", fail);
        if (window.google?.accounts?.id) resolve();
        return;
      }
      const script = document.createElement("script");
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.onload = ready;
      script.onerror = fail;
      document.head.appendChild(script);
    });

  const makeNonce = async () => {
    const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
    const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(nonce));
    const hashedNonce = Array.from(new Uint8Array(hash))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    return { nonce, hashedNonce };
  };

  const googleSvg = `<svg viewBox="0 0 18 18" aria-hidden="true" width="18" height="18"><path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"/><path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.83.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z"/><path fill="#FBBC05" d="M3.97 10.72A5.41 5.41 0 0 1 3.68 9c0-.6.1-1.18.29-1.72V4.95H.96A9 9 0 0 0 0 9c0 1.45.35 2.82.96 4.05l3.01-2.33z"/><path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z"/></svg>`;
  const userSvg = `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4zm0 2c-3.31 0-8 1.66-8 5v1h16v-1c0-3.34-4.69-5-8-5z"/></svg>`;

  const googleBtn = (label = "Continue with Google") =>
    `<button class="btn btn--google" type="button" data-auth-google>${googleSvg}${label}</button>`;

  const initialsOf = (name, email) => {
    const source = (name || email || "?").trim();
    const parts = source.split(/[\s.@]+/).filter(Boolean);
    return ((parts[0]?.[0] || "?") + (parts[1]?.[0] || "")).toUpperCase();
  };

  const copy = {
    signin: {
      title: "Welcome back",
      lead: "Sign in to track bookings, tickets and drops.",
      submit: "Sign in",
    },
    signup: {
      title: "Join the pack",
      lead: "Create an account to save tickets and get updates.",
      submit: "Create account",
    },
    forgot: {
      title: "Reset password",
      lead: "We’ll email you a link from Team Bulldogs.",
      submit: "Send reset link",
    },
    recovery: {
      title: "New password",
      lead: "Choose a password for your Bulldogs account.",
      submit: "Save password",
    },
    checkemail: {
      title: "Check your inbox",
      lead: "Confirm your email, then sign in. You can keep browsing in the meantime.",
      submit: "",
    },
  };

  const dialogHtml = `<dialog class="booking-dialog auth-dialog" data-auth-dialog aria-labelledby="auth-dialog-title">
      <button class="booking-dialog__close" type="button" data-auth-close aria-label="Close">×</button>
      <form class="contact-form" data-auth-modal-form novalidate>
        <header class="booking-dialog__head">
          <h2 id="auth-dialog-title" data-auth-title>Welcome back</h2>
          <p class="muted" data-auth-lead>Sign in to track bookings, tickets and drops.</p>
        </header>

        <div data-auth-view="main">
          <div class="auth-seg" role="tablist">
            <button type="button" class="is-active" data-auth-goto="signin">Login</button>
            <button type="button" data-auth-goto="signup">Register</button>
          </div>
          <div class="field" data-signup-only hidden>
            <label for="auth_full_name">Your name</label>
            <input id="auth_full_name" name="full_name" type="text" autocomplete="name" maxlength="200" />
          </div>
          <div class="field">
            <label for="auth_email">Email</label>
            <input id="auth_email" name="email" type="email" autocomplete="username" maxlength="254" />
          </div>
          <div class="field">
            <span class="field-label-row">
              <label for="auth_password">Password</label>
              <button class="text-btn" type="button" data-auth-goto="forgot" data-signin-only>Forgot?</button>
            </span>
            <input id="auth_password" name="password" type="password" minlength="6" autocomplete="current-password" />
            <p class="field-hint">At least 6 characters.</p>
          </div>
          <button class="btn btn--accent btn--block" type="submit" data-auth-submit>Sign in</button>
          <p class="auth-or">or</p>
          <div class="auth-google" data-gis-host></div>
        </div>

        <div data-auth-view="forgot" hidden>
          <div class="field">
            <label for="auth_email_reset">Email</label>
            <input id="auth_email_reset" name="email_reset" type="email" autocomplete="email" maxlength="254" />
          </div>
          <button class="btn btn--accent btn--block" type="submit">Send reset link</button>
          <p class="auth-switch"><button class="text-btn" type="button" data-auth-goto="signin">Back to sign in</button></p>
        </div>

        <div data-auth-view="recovery" hidden>
          <div class="field">
            <label for="auth_new_password">New password</label>
            <input id="auth_new_password" name="new_password" type="password" minlength="6" autocomplete="new-password" />
          </div>
          <button class="btn btn--accent btn--block" type="submit">Save password</button>
        </div>

        <div data-auth-view="checkemail" hidden>
          <p class="auth-switch"><button class="text-btn" type="button" data-auth-goto="signin">Back to sign in</button></p>
        </div>

        <p class="form-status" data-auth-status role="status"></p>
      </form>
    </dialog>`;

  const ensureDialog = () => {
    let dialog = document.querySelector("[data-auth-dialog]");
    if (dialog) return dialog;
    document.body.insertAdjacentHTML("beforeend", dialogHtml);
    dialog = document.querySelector("[data-auth-dialog]");
    bindDialog(dialog);
    return dialog;
  };

  const setStatus = (msg = "", isError = false) => {
    const el = document.querySelector("[data-auth-status]");
    if (!el) return;
    el.textContent = msg;
    el.classList.toggle("is-error", isError);
  };

  const currentView = () => document.querySelector("[data-auth-modal-form]")?.dataset.view || "signin";

  const setView = (name) => {
    const form = document.querySelector("[data-auth-modal-form]");
    if (!form) return;
    const main = name === "signin" || name === "signup";
    form.dataset.view = name;
    form.querySelectorAll("[data-auth-view]").forEach((el) => {
      const key = el.getAttribute("data-auth-view");
      el.hidden = main ? key !== "main" : key !== name;
    });
    form.querySelectorAll("[data-signup-only]").forEach((el) => {
      el.hidden = name !== "signup";
    });
    form.querySelectorAll("[data-signin-only]").forEach((el) => {
      el.hidden = name !== "signin";
    });
    form.querySelectorAll(".auth-seg [data-auth-goto]").forEach((btn) => {
      btn.classList.toggle("is-active", btn.getAttribute("data-auth-goto") === name);
    });
    const meta = copy[name] || copy.signin;
    const title = form.querySelector("[data-auth-title]");
    const lead = form.querySelector("[data-auth-lead]");
    const submit = form.querySelector("[data-auth-submit]");
    if (title) title.textContent = meta.title;
    if (lead) lead.textContent = meta.lead;
    if (submit) submit.textContent = meta.submit;
    const password = form.querySelector("#auth_password");
    if (password) password.autocomplete = name === "signup" ? "new-password" : "current-password";
    setStatus("");
    if (main && document.querySelector("[data-auth-dialog]")?.open) mountGoogle(name);
  };

  const close = () => {
    const dialog = document.querySelector("[data-auth-dialog]");
    if (dialog?.open) dialog.close();
  };

  const mountGoogle = async (view = currentView()) => {
    const host = document.querySelector("[data-gis-host]");
    if (!host) return;
    const clientId = cfg().googleClientId;
    host.innerHTML = googleBtn();
    if (!clientId) return;
    try {
      const sb = await whenReady();
      const { nonce, hashedNonce } = await makeNonce();
      await loadGsi();
      window.google.accounts.id.initialize({
        client_id: clientId,
        nonce: hashedNonce,
        callback: async (response) => {
          try {
            const { error } = await sb.auth.signInWithIdToken({
              provider: "google",
              token: response.credential,
              nonce,
            });
            if (error) throw error;
            close();
            goNext();
          } catch (err) {
            setStatus(err.message || "Google sign-in failed.", true);
          }
        },
        auto_select: false,
        cancel_on_tap_outside: true,
        context: view === "signup" ? "signup" : "signin",
        ux_mode: "popup",
        use_fedcm_for_prompt: true,
      });
      host.innerHTML = "";
      const width = Math.min(360, Math.max(220, Math.floor(host.clientWidth || 320)));
      window.google.accounts.id.renderButton(host, {
        type: "standard",
        theme: "outline",
        size: "large",
        text: "continue_with",
        shape: "pill",
        width,
        logo_alignment: "left",
      });
    } catch {
      host.innerHTML = googleBtn();
    }
  };

  const google = async () => {
    ensureDialog();
    if (!document.querySelector("[data-auth-dialog]")?.open) {
      await open({ mode: "signin" });
      return;
    }
    await mountGoogle();
    document.querySelector("[data-auth-view='main'] [data-gis-host] div[role=button]")?.click();
  };

  const signIn = async (email, password) => {
    const sb = await whenReady();
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) throw error;
  };

  const signUp = async ({ email, password, full_name }) => {
    const client = api();
    if (!client) throw new Error("Couldn't reach the server.");
    if (!password || password.length < 6) throw new Error("Password must be at least 6 characters.");
    await client.fn("auth-api", { action: "signup", email, password, full_name: full_name || null });
  };

  const reset = async (email) => {
    const client = api();
    if (!client) throw new Error("Couldn't reach the server.");
    await client.fn("auth-api", { action: "reset", email });
  };

  const open = async ({ mode = "signin", next } = {}) => {
    if (window.BULLDOGS_SESSION && mode !== "recovery") {
      closeMenu();
      openMenu();
      return;
    }
    if (next) pendingNext = next;
    closeMenu();
    const dialog = ensureDialog();
    setView(mode);
    if (!dialog.open) dialog.showModal();
    if (mode === "signin" || mode === "signup") await mountGoogle(mode);
    const focusId = mode === "forgot" ? "auth_email_reset" : mode === "recovery" ? "auth_new_password" : mode === "signup" ? "auth_full_name" : "auth_email";
    dialog.querySelector(`#${focusId}`)?.focus();
  };

  const bindDialog = (dialog) => {
    const form = dialog.querySelector("[data-auth-modal-form]");
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) close();
    });
    dialog.querySelector("[data-auth-close]")?.addEventListener("click", close);
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      close();
    });
    form.addEventListener("click", (event) => {
      const goto = event.target.closest("[data-auth-goto]");
      if (!goto) return;
      event.preventDefault();
      setView(goto.getAttribute("data-auth-goto"));
    });
    form.addEventListener("click", async (event) => {
      const googleEl = event.target.closest("[data-auth-google]");
      if (!googleEl) return;
      event.preventDefault();
      setStatus("Continue with Google…");
      try {
        await google();
        setStatus("");
      } catch (err) {
        setStatus(err.message || "Google sign-in isn’t set up yet.", true);
      }
    });
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const view = currentView();
      const data = new FormData(form);
      try {
        if (view === "signin") {
          setStatus("Signing in…");
          await signIn(String(data.get("email") || ""), String(data.get("password") || ""));
          setStatus("");
          close();
          goNext();
          return;
        }
        if (view === "signup") {
          setStatus("Creating your account…");
          await signUp({
            email: String(data.get("email") || ""),
            password: String(data.get("password") || ""),
            full_name: String(data.get("full_name") || ""),
          });
          setView("checkemail");
          return;
        }
        if (view === "forgot") {
          const email = String(data.get("email_reset") || data.get("email") || "");
          if (!email) {
            setStatus("Enter your email first.", true);
            return;
          }
          setStatus("Sending reset email…");
          await reset(email);
          setStatus("Check your inbox for a reset link from Team Bulldogs.");
          return;
        }
        if (view === "recovery") {
          const password = String(data.get("new_password") || "");
          if (password.length < 6) {
            setStatus("Password must be at least 6 characters.", true);
            return;
          }
          const sb = await whenReady();
          const { error } = await sb.auth.updateUser({ password });
          if (error) throw error;
          setStatus("Password updated. You’re signed in.");
          close();
          goNext();
        }
      } catch (err) {
        setStatus(err.message || "Something went wrong.", true);
      }
    });
  };

  const whenFmt = (iso) =>
    new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/London" }).format(new Date(iso));

  const ensureMenu = () => {
    let menu = document.querySelector("[data-account-menu]");
    if (menu) return menu;
    const actions = document.querySelector(".nav__actions") || document.querySelector(".nav");
    if (!actions) return null;
    const wrap = document.createElement("div");
    wrap.className = "account-menu";
    wrap.dataset.accountMenu = "";
    wrap.innerHTML = `<button class="account-menu__btn" type="button" data-account-toggle aria-expanded="false" aria-haspopup="dialog" aria-label="Sign in">${userSvg}</button>
      <div class="account-menu__panel" data-account-panel hidden></div>`;
    const toggle = actions.querySelector(".nav-toggle");
    actions.insertBefore(wrap, toggle || null);
    return wrap;
  };

  const closeMenu = () => {
    menuOpen = false;
    const menu = document.querySelector("[data-account-menu]");
    if (!menu) return;
    menu.classList.remove("is-open");
    menu.querySelector("[data-account-toggle]")?.setAttribute("aria-expanded", "false");
    const panel = menu.querySelector("[data-account-panel]");
    if (panel) panel.hidden = true;
  };

  const openMenu = () => {
    const menu = ensureMenu();
    if (!menu) return;
    menuOpen = true;
    menu.classList.add("is-open");
    menu.querySelector("[data-account-toggle]")?.setAttribute("aria-expanded", "true");
    const panel = menu.querySelector("[data-account-panel]");
    if (panel) panel.hidden = false;
    if (window.BULLDOGS_SESSION) loadAccountPanel();
  };

  const renderUserChrome = (session, profile) => {
    const menu = document.querySelector("[data-account-menu]");
    const btn = menu?.querySelector("[data-account-toggle]");
    const name = profile?.profile?.full_name || session?.user?.user_metadata?.full_name || "";
    const email = profile?.email || session?.user?.email || "";
    if (btn) {
      btn.innerHTML = `<span class="account-menu__avatar">${initialsOf(name, email)}</span>`;
      btn.setAttribute("aria-label", name || email || "Account");
      btn.setAttribute("aria-haspopup", "true");
    }
  };

  const renderUserPanel = (session, profile, bookings = []) => {
    const panel = document.querySelector("[data-account-panel]");
    if (!panel) return;
    const name = profile?.profile?.full_name || session?.user?.user_metadata?.full_name || "";
    const email = profile?.email || session?.user?.email || "";
    const rows = (bookings || []).filter((b) => b.status === "paid" || b.status === "pending");
    const bookingHtml = rows.length
      ? rows
          .map((b) => {
            const event = b.event || {};
            const eligible =
              b.status === "paid" && event.starts_at && Date.now() <= new Date(event.starts_at).getTime() - 24 * 60 * 60 * 1000;
            const cancel = eligible ? `<button class="text-btn" type="button" data-cancel-booking="${b.id}">Cancel</button>` : "";
            const ticket = b.cancel_token ? `<a href="ticket.html?c=${b.cancel_token}">Tickets</a>` : "";
            return `<article class="account-menu__booking"><strong>${event.title || "Event"}</strong><p class="muted">${event.starts_at ? whenFmt(event.starts_at) : ""} · ${b.status}</p><p>${ticket} ${cancel}</p></article>`;
          })
          .join("")
      : `<p class="muted">No bookings yet.</p>`;
    const club = profile?.is_admin ? `<a class="account-menu__item" href="club.html">Admin tools</a>` : "";
    panel.innerHTML = `<div class="account-menu__who">
        <span class="account-menu__avatar"></span>
        <div>
          <div class="account-menu__name-row" data-name-view>
            <strong data-account-name></strong>
            <button class="text-btn" type="button" data-account-edit>Edit</button>
          </div>
          <form class="account-menu__form" data-account-profile hidden>
            <div class="field">
              <label for="account_full_name">Name</label>
              <input id="account_full_name" name="full_name" type="text" maxlength="200" autocomplete="name" />
            </div>
            <div class="account-menu__edit-actions">
              <button class="btn btn--accent btn--small" type="submit" data-account-save hidden>Save</button>
              <button class="text-btn" type="button" data-account-edit-cancel>Cancel</button>
            </div>
            <p class="form-status" role="status"></p>
          </form>
          <p class="muted" data-account-email></p>
        </div>
      </div>
      <div class="account-menu__bookings">
        <p class="account-menu__label">Bookings</p>
        ${bookingHtml}
      </div>
      ${club}
      <button class="account-menu__item account-menu__item--out" type="button" data-account-out>Sign out</button>`;
    panel.querySelector(".account-menu__avatar").textContent = initialsOf(name, email);
    panel.querySelector("[data-account-name]").textContent = name || "Add your name";
    panel.querySelector("[data-account-email]").textContent = email;
    const form = panel.querySelector("[data-account-profile]");
    if (form) {
      form.full_name.value = name;
      form.dataset.original = name;
    }
  };

  const nameFormDirty = () => {
    const form = document.querySelector("[data-account-profile]");
    if (!form || form.hidden) return false;
    return form.full_name.value.trim() !== (form.dataset.original || "").trim();
  };

  const syncNameSave = (form) => {
    const save = form?.querySelector("[data-account-save]");
    if (!save) return;
    save.hidden = form.full_name.value.trim() === (form.dataset.original || "").trim();
  };

  const loadAccountPanel = async () => {
    const session = window.BULLDOGS_SESSION;
    const panel = document.querySelector("[data-account-panel]");
    if (!session || !panel) return;
    const keepEdit = nameFormDirty();
    if (profileCache && !keepEdit) {
      renderUserChrome(session, profileCache);
      renderUserPanel(session, profileCache, profileCache.bookings || []);
    }
    try {
      const profile = await api()?.fn("me-api", { action: "profile" });
      const bookings = await api()?.fn("me-api", { action: "bookings" });
      profileCache = { ...profile, bookings: bookings?.bookings || [] };
      renderUserChrome(session, profileCache);
      if (!nameFormDirty()) renderUserPanel(session, profileCache, profileCache.bookings);
    } catch (err) {
      const status = panel.querySelector(".form-status");
      if (status) {
        status.textContent = err.message;
        status.classList.add("is-error");
      }
    }
  };

  const paintMenu = (session) => {
    ensureMenu();
    const btn = document.querySelector("[data-account-toggle]");
    if (!session) {
      profileCache = null;
      closeMenu();
      if (btn) {
        btn.innerHTML = userSvg;
        btn.setAttribute("aria-label", "Sign in");
        btn.setAttribute("aria-haspopup", "dialog");
      }
      return;
    }
    renderUserChrome(session, profileCache);
    if (menuOpen) loadAccountPanel();
    else if (profileCache) renderUserChrome(session, profileCache);
    else {
      api()
        ?.fn("me-api", { action: "profile" })
        .then((profile) => {
          profileCache = { ...profile, bookings: profileCache?.bookings || [] };
          renderUserChrome(session, profileCache);
        })
        .catch(() => renderUserChrome(session, null));
    }
  };

  const bindAccountMenu = () => {
    const menu = ensureMenu();
    if (!menu || menu.dataset.bound) return;
    menu.dataset.bound = "1";
    menu.querySelector("[data-account-toggle]")?.addEventListener("click", (event) => {
      event.stopPropagation();
      if (!window.BULLDOGS_SESSION) {
        closeMenu();
        open({ mode: "signin" });
        return;
      }
      if (menuOpen) closeMenu();
      else openMenu();
    });
    menu.addEventListener("click", async (event) => {
      const out = event.target.closest("[data-account-out]");
      const cancel = event.target.closest("[data-cancel-booking]");
      const edit = event.target.closest("[data-account-edit]");
      const editCancel = event.target.closest("[data-account-edit-cancel]");
      if (out) {
        event.preventDefault();
        const sb = await whenReady();
        await sb.auth.signOut();
        closeMenu();
      }
      if (edit) {
        event.preventDefault();
        const form = menu.querySelector("[data-account-profile]");
        const view = menu.querySelector("[data-name-view]");
        if (form) form.hidden = false;
        if (view) view.hidden = true;
        syncNameSave(form);
        form?.full_name.focus();
      }
      if (editCancel) {
        event.preventDefault();
        const form = menu.querySelector("[data-account-profile]");
        const view = menu.querySelector("[data-name-view]");
        if (form) {
          form.full_name.value = form.dataset.original || "";
          form.hidden = true;
          syncNameSave(form);
          const st = form.querySelector(".form-status");
          if (st) st.textContent = "";
        }
        if (view) view.hidden = false;
      }
      if (cancel) {
        event.preventDefault();
        if (!confirm("Cancel this booking and refund if you're outside 24 hours?")) return;
        try {
          await api().fn("me-api", { action: "cancel_booking", booking_id: cancel.dataset.cancelBooking });
          await loadAccountPanel();
        } catch (err) {
          alert(err.message);
        }
      }
    });
    menu.addEventListener("input", (event) => {
      const form = event.target.closest("[data-account-profile]");
      if (form) syncNameSave(form);
    });
    menu.addEventListener("submit", async (event) => {
      const form = event.target.closest("[data-account-profile]");
      if (!form) return;
      event.preventDefault();
      if (!nameFormDirty()) return;
      const st = form.querySelector(".form-status");
      try {
        await api().fn("me-api", {
          action: "save_profile",
          full_name: form.full_name.value,
        });
        form.dataset.original = form.full_name.value.trim();
        if (st) {
          st.textContent = "Saved.";
          st.classList.remove("is-error");
        }
        await loadAccountPanel();
      } catch (err) {
        if (st) {
          st.textContent = err.message;
          st.classList.add("is-error");
        }
      }
    });
  };

  document.addEventListener("click", (event) => {
    if (!event.target.closest("[data-account-menu]")) closeMenu();
    const trigger = event.target.closest("[data-open-auth]");
    if (!trigger) return;
    event.preventDefault();
    const mode = trigger.getAttribute("data-open-auth") || "signin";
    open({ mode: mode === "signup" ? "signup" : mode || "signin" });
  });

  const bindCheckout = (root, { onGuest } = {}) => {
    if (!root) return;
    const status = () => root.querySelector("[data-auth-status]") || root.closest("form")?.querySelector(".form-status");
    const setCheckoutStatus = (msg, isError = false) => {
      const el = status();
      if (!el) return;
      el.textContent = msg;
      el.classList.toggle("is-error", isError);
    };
    const refresh = (session) => {
      const logged = root.querySelector("[data-auth-logged-in]");
      const guest = root.querySelector("[data-auth-guest]");
      if (logged) logged.hidden = !session;
      if (guest) guest.hidden = Boolean(session);
      const as = root.querySelector("[data-auth-as]");
      if (as && session?.user) as.textContent = session.user.email;
    };
    whenReady()
      .then((sb) => {
        sb.auth.onAuthStateChange((_e, session) => refresh(session));
        sb.auth.getSession().then(({ data }) => refresh(data.session));
      })
      .catch(() => {});
    root.addEventListener("click", async (e) => {
      const out = e.target.closest("[data-auth-out]");
      if (out) {
        e.preventDefault();
        const sb = await whenReady();
        await sb.auth.signOut();
      }
    });
    root.querySelector("[data-checkout-guest]")?.addEventListener("click", () => {
      if (typeof onGuest === "function") onGuest();
    });
    root.setCheckoutStatus = setCheckoutStatus;
  };

  bindAccountMenu();
  paintMenu(window.BULLDOGS_SESSION);

  whenReady()
    .then((sb) => {
      ensureDialog();
      bindAccountMenu();
      loadGsi().catch(() => {});
      sb.auth.onAuthStateChange((event, session) => {
        paintMenu(session);
        if (event === "PASSWORD_RECOVERY") open({ mode: "recovery" });
      });
      sb.auth.getSession().then(({ data }) => paintMenu(data.session));
    })
    .catch(() => {});

  window.BULLDOGS_AUTH = {
    whenReady,
    google,
    signIn,
    signUp,
    reset,
    nextPath,
    goNext,
    googleBtn,
    bindCheckout,
    open,
    close,
    openMenu,
    closeMenu,
  };
})();
