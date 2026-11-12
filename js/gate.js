(() => {
  const KEY = "bulldogs-testing";
  const PASSWORD = "BulldogsTesting2026";

  const unlocked = () => {
    try {
      return localStorage.getItem(KEY) === "1";
    } catch (err) {
      return false;
    }
  };

  if (unlocked()) return;

  document.documentElement.classList.add("site-locked");

  const mount = () => {
    if (unlocked() || document.querySelector(".site-gate")) return;

    const gate = document.createElement("div");
    gate.className = "site-gate";
    gate.setAttribute("role", "dialog");
    gate.setAttribute("aria-modal", "true");
    gate.setAttribute("aria-labelledby", "site-gate-title");
    gate.innerHTML = `
      <form class="site-gate__box">
        <img src="assets/logo.png" alt="" />
        <h1 id="site-gate-title">Team Bulldogs</h1>
        <p>Enter the testing password to continue.</p>
        <label class="sr-only" for="site-gate-password">Password</label>
        <input id="site-gate-password" type="password" autocomplete="off" required />
        <button class="btn btn--accent" type="submit">Continue</button>
        <p class="site-gate__status" data-gate-status role="status"></p>
      </form>`;
    document.body.appendChild(gate);

    const lockPage = () => {
      [...document.body.children].forEach((el) => {
        if (el !== gate) el.inert = true;
      });
    };
    lockPage();

    const form = gate.querySelector("form");
    const input = gate.querySelector("input");
    const status = gate.querySelector("[data-gate-status]");
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (input.value.trim() !== PASSWORD) {
        status.textContent = "That password isn't right.";
        input.select();
        return;
      }
      try {
        localStorage.setItem(KEY, "1");
      } catch (err) {}
      [...document.body.children].forEach((el) => {
        el.inert = false;
      });
      document.documentElement.classList.remove("site-locked");
      gate.remove();
    });
    input.focus();
  };

  if (document.body) mount();
  else document.addEventListener("DOMContentLoaded", mount);
})();
