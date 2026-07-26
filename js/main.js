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
  }

  if (contactForm) {
    contactForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const status = contactForm.querySelector(".form-status");
      if (status) {
        status.textContent = "Thanks — message received (demo only). We’ll be in touch.";
      }
      contactForm.reset();
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
