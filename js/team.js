(() => {
  const api = window.BULLDOGS_API;
  const coachesEl = document.querySelector("[data-team-coaches]");
  const squadEl = document.querySelector("[data-team-squad]");
  if (!api || (!coachesEl && !squadEl)) return;

  const escapeHtml = (value) =>
    String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  const isCoach = (athlete) => /coach/i.test(String(athlete.role || ""));

  const coachCard = (athlete) => {
    const kit = athlete.kit_number != null ? `#${athlete.kit_number} · ` : "";
    return `<article class="coach glass">
      <img src="${escapeHtml(athlete.image_url || "")}" alt="${escapeHtml(athlete.name)}" data-editable-media="athlete" data-athlete-id="${escapeHtml(athlete.id)}" />
      <div><b>${escapeHtml(athlete.name)}</b><span>${escapeHtml(kit + (athlete.role || "Coach"))}</span></div>
    </article>`;
  };

  const athleteCard = (athlete) => {
    const num = athlete.kit_number != null ? ` data-num="${escapeHtml(String(athlete.kit_number))}"` : "";
    return `<article class="ath"${num}><img src="${escapeHtml(athlete.image_url || "")}" alt="${escapeHtml(athlete.name)}" data-editable-media="athlete" data-athlete-id="${escapeHtml(athlete.id)}" /><div><b>${escapeHtml(athlete.name)}</b><span>${escapeHtml(athlete.role || "Athlete")}</span></div></article>`;
  };

  const joinCard = `<a class="ath ath--join" href="events.html">
    <img src="assets/logo.png" alt="" />
    <div><b>Train with the pack</b><span>See what’s coming up</span></div>
  </a>`;

  api
    .rpc("list_athletes")
    .then((athletes) => {
      const rows = [...(athletes || [])].sort(
        (a, b) => (a.sort_order ?? 100) - (b.sort_order ?? 100) || String(a.name).localeCompare(String(b.name)),
      );
      const coaches = rows.filter(isCoach);
      const squad = rows.filter((row) => !isCoach(row));
      if (coachesEl && coaches.length) coachesEl.innerHTML = coaches.map(coachCard).join("");
      if (squadEl) squadEl.innerHTML = `${squad.map(athleteCard).join("")}${joinCard}`;
      window.BULLDOGS_MEDIA_EDIT?.refresh?.();
    })
    .catch(() => {});
})();
