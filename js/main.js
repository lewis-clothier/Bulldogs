(() => {
  const toggle = document.querySelector(".nav-toggle");
  const links = document.querySelector(".nav__links");
  const contactForm = document.querySelector("#contact-form");
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  if (toggle && links) {
    toggle.addEventListener("click", () => {
      const open = toggle.getAttribute("aria-expanded") === "true";
      toggle.setAttribute("aria-expanded", String(!open));
      links.classList.toggle("is-open", !open);
      document.body.style.overflow = open ? "" : "hidden";
    });

    links.querySelectorAll("a").forEach((a) => {
      a.addEventListener("click", () => {
        toggle.setAttribute("aria-expanded", "false");
        links.classList.remove("is-open");
        document.body.style.overflow = "";
      });
    });
  }

  const revealEls = document.querySelectorAll(".reveal");
  if (revealEls.length && "IntersectionObserver" in window) {
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            entry.target.querySelectorAll(".media-frame").forEach((frame) => {
              frame.classList.add("is-settled");
            });
            io.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -40px 0px" }
    );
    revealEls.forEach((el) => io.observe(el));
  } else {
    revealEls.forEach((el) => {
      el.classList.add("is-visible");
      el.querySelectorAll(".media-frame").forEach((frame) => {
        frame.classList.add("is-settled");
      });
    });
  }

  // Settle media frames that are already on-screen without a .reveal parent
  document.querySelectorAll(".media-frame").forEach((frame) => {
    if (!frame.closest(".reveal")) {
      frame.classList.add("is-settled");
    }
  });

  if (!reduceMotion) {
    const parallaxImgs = [...document.querySelectorAll("[data-parallax]")];
    let ticking = false;

    const updateParallax = () => {
      const vh = window.innerHeight;
      parallaxImgs.forEach((img) => {
        const parent = img.closest(".photo-band, .page-banner") || img.parentElement;
        if (!parent) return;
        const rect = parent.getBoundingClientRect();
        const mid = rect.top + rect.height / 2;
        const progress = (mid - vh / 2) / vh;
        const shift = Math.max(-8, Math.min(8, progress * -6));
        img.style.transform = `translate3d(0, ${shift}%, 0) scale(1.08)`;
      });
      ticking = false;
    };

    const onParallaxScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(updateParallax);
    };

    if (parallaxImgs.length) {
      window.addEventListener("scroll", onParallaxScroll, { passive: true });
      window.addEventListener("resize", onParallaxScroll, { passive: true });
      updateParallax();
    }

    const carousel = document.querySelector(".hero__carousel");
    const track = carousel?.querySelector(".hero__track");
    if (carousel && track) {
      const repeatCount = 3;

      const getTranslateX = () => {
        const { transform } = getComputedStyle(track);
        if (!transform || transform === "none") return 0;
        return new DOMMatrixReadOnly(transform).m41;
      };

      const loopWidth = () => track.scrollWidth / repeatCount;

      const wrapX = (x) => {
        const w = loopWidth();
        if (w <= 0) return 0;
        let wrapped = x % w;
        if (wrapped > 0) wrapped -= w;
        return wrapped;
      };

      const durationSec = () => {
        const raw = getComputedStyle(track).animationDuration || "45s";
        const n = parseFloat(raw);
        return Number.isFinite(n) && n > 0 ? n : 45;
      };

      let dragging = false;
      let pointerId = null;
      let startX = 0;
      let originX = 0;
      let moved = false;
      let dragDuration = 45;

      const onPointerDown = (e) => {
        if (e.button != null && e.button !== 0) return;
        dragging = true;
        moved = false;
        pointerId = e.pointerId;
        startX = e.clientX;
        dragDuration = durationSec();
        originX = getTranslateX();
        track.classList.add("is-dragging");
        carousel.classList.add("is-dragging");
        track.style.transform = `translate3d(${originX}px, 0, 0)`;
        carousel.setPointerCapture?.(e.pointerId);
      };

      const onPointerMove = (e) => {
        if (!dragging || e.pointerId !== pointerId) return;
        const dx = e.clientX - startX;
        if (Math.abs(dx) > 3) moved = true;
        if (moved) e.preventDefault();
        const x = wrapX(originX + dx);
        track.style.transform = `translate3d(${x}px, 0, 0)`;
      };

      const endDrag = (e) => {
        if (!dragging || (e && e.pointerId !== pointerId)) return;
        dragging = false;
        pointerId = null;

        const x = wrapX(getTranslateX());
        const w = loopWidth();
        const progress = w > 0 ? Math.min(1, Math.max(0, -x / w)) : 0;
        const delay = -progress * dragDuration;

        track.style.transform = `translate3d(${x}px, 0, 0)`;
        track.style.animationDelay = `${delay}s`;
        void track.offsetWidth;
        track.style.transform = "";
        track.classList.remove("is-dragging");
        carousel.classList.remove("is-dragging");
      };

      carousel.addEventListener("pointerdown", onPointerDown);
      carousel.addEventListener("pointermove", onPointerMove, { passive: false });
      carousel.addEventListener("pointerup", endDrag);
      carousel.addEventListener("pointercancel", endDrag);
    }
  }

  if (contactForm) {
    const CONTACT_EMAIL = "bulldogs.limited@gmail.com";
    const status = contactForm.querySelector(".form-status");
    const submitBtn = contactForm.querySelector('[type="submit"]');

    contactForm.addEventListener("submit", async (e) => {
      e.preventDefault();

      const honey = contactForm.querySelector('[name="_honey"]');
      if (honey?.value) return;

      const formData = new FormData(contactForm);
      const name = String(formData.get("name") || "").trim();
      const email = String(formData.get("email") || "").trim();
      const topic = String(formData.get("topic") || "Enquiry").trim();
      const message = String(formData.get("message") || "").trim();

      if (status) {
        status.textContent = "Sending…";
        status.classList.remove("is-error");
      }
      if (submitBtn) submitBtn.disabled = true;

      try {
        const res = await fetch(`https://formsubmit.co/ajax/${CONTACT_EMAIL}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            name,
            email,
            topic,
            message,
            _subject: `Bulldogs contact — ${topic}`,
            _template: "table",
            _captcha: "false",
            _honey: "",
            replyto: email,
          }),
        });

        const data = await res.json().catch(() => ({}));
        const ok = res.ok && data.success !== "false" && data.success !== false;

        if (!ok) {
          throw new Error(data.message || "Send failed");
        }

        if (status) {
          status.textContent = "Thanks — message sent. We’ll be in touch.";
          status.classList.remove("is-error");
        }
        contactForm.reset();
      } catch {
        if (status) {
          status.textContent = "Couldn’t send right now. Email us at bulldogs.limited@gmail.com.";
          status.classList.add("is-error");
        }
      } finally {
        if (submitBtn) submitBtn.disabled = false;
      }
    });
  }

  const showCopiedToast = (anchor) => {
    const host = anchor.closest("li") || anchor.parentElement || document.body;
    let toast = host.querySelector(".copy-toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.className = "copy-toast";
      toast.setAttribute("role", "status");
      toast.setAttribute("aria-live", "polite");
      host.appendChild(toast);
    }
    toast.textContent = "Copied!";
    toast.classList.add("is-visible");
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => {
      toast.classList.remove("is-visible");
    }, 1600);
  };

  const copyEmail = async (email, anchor) => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(email);
      } else {
        const input = document.createElement("textarea");
        input.value = email;
        input.setAttribute("readonly", "");
        input.style.position = "fixed";
        input.style.left = "-9999px";
        document.body.appendChild(input);
        input.select();
        document.execCommand("copy");
        document.body.removeChild(input);
      }
      showCopiedToast(anchor);
    } catch {
      showCopiedToast(anchor);
    }
  };

  document.querySelectorAll("[data-copy-email]").forEach((el) => {
    el.addEventListener("click", () => {
      const email = el.getAttribute("data-copy-email");
      if (email) copyEmail(email, el);
    });
  });
})();
