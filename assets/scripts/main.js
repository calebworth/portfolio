(() => {
  /**
   * UI behaviors:
   * - Simple i18n toggle (Japanese <-> English)
   * - Button shimmer hover/focus animation
   */

  /**
   * Simple i18n toggle (Japanese <-> English)
   * - Updates text for any element with [data-i18n]
   * - Persists choice in localStorage when available
   */
  const I18N = {
    ja: {
      name: "ケイレブ・ワース",
      role: "ソフトウェアエンジニア",
      title: "ソフトウェアエンジニア | ケイレブ・ワース",
      techResume: "技術レジュメ",
      nonTechResume: "非技術レジュメ",
      linkedin: "LinkedIn",
    },
    en: {
      name: "Caleb Worth",
      role: "Software Engineer",
      title: "Software Engineer | Caleb",
      techResume: "Technical Resume",
      nonTechResume: "Non Technical Resume",
      linkedin: "LinkedIn",
    },
  };

  const RESUME_LINKS = {
    ja: {
      tech: "./assets/resumes/JP/Tai_Tran_Software_Engineer_Resume_JP.pdf",
      nonTech: "./assets/resumes/JP/Tai_Tran_Non_Technical_Resume_JP.pdf",
    },
    en: {
      tech: "./assets/resumes/EN/Tai_Tran_Software_Engineer_Resume.pdf",
      nonTech: "./assets/resumes/EN/Tai_Tran_Non_Technical_Resume.pdf",
    },
  };

  const langBtn = document.getElementById("lang-toggle");
  /** @type {'ja' | 'en'} */
  let lang = "ja";

  function updateLangToggleButton(currentLang) {
    if (!(langBtn instanceof HTMLElement)) return;
    const switchingToEnglish = currentLang === "ja";
    const nextLabel = switchingToEnglish ? "EN" : "\u65E5\u672C\u8A9E";
    const nextAriaLabel = switchingToEnglish ? "Switch to English" : "Switch to Japanese";

    const labelEl = langBtn.querySelector(".btn-label");
    if (labelEl instanceof HTMLElement) {
      labelEl.textContent = nextLabel;
    } else {
      langBtn.textContent = nextLabel;
    }

    langBtn.setAttribute("aria-label", nextAriaLabel);
    langBtn.setAttribute("title", nextAriaLabel);
  }

  try {
    const stored = localStorage.getItem("lang");
    if (stored === "ja" || stored === "en") lang = stored;
    else {
      const htmlLang = document.documentElement.getAttribute("lang");
      if (htmlLang === "ja" || htmlLang === "en") lang = htmlLang;
    }
  } catch {
    // Ignore if storage is unavailable
  }

  function applyLanguage(nextLang) {
    lang = nextLang;
    document.documentElement.setAttribute("lang", lang);

    const nameEl = document.querySelector(".name");
    if (nameEl instanceof HTMLElement) nameEl.setAttribute("lang", lang);

    for (const el of document.querySelectorAll("[data-i18n]")) {
      if (!(el instanceof HTMLElement)) continue;
      const key = el.getAttribute("data-i18n");
      if (!key) continue;
      const value = I18N[lang]?.[key];
      if (typeof value === "string") el.textContent = value;
    }

    const title = I18N[lang]?.title;
    if (typeof title === "string") {
      document.title = title;
    }

    updateLangToggleButton(lang);

    updateResumeLinks(lang);

    try {
      localStorage.setItem("lang", lang);
    } catch {
      // Ignore if storage is unavailable
    }
  }

  if (langBtn) {
    langBtn.addEventListener("click", () => {
      applyLanguage(lang === "ja" ? "en" : "ja");
    });
  }

  function updateResumeLinks(currentLang) {
    const links = RESUME_LINKS[currentLang];
    if (!links) return;
    const techLink = document.querySelector('[data-resume="tech"]');
    if (techLink instanceof HTMLAnchorElement) {
      techLink.href = links.tech;
    }
    const nonTechLink = document.querySelector('[data-resume="nontech"]');
    if (nonTechLink instanceof HTMLAnchorElement) {
      nonTechLink.href = links.nonTech;
    }
  }

  // Loop shimmer while hovered; still let the current sweep finish on leave.
  const shimmerButtons = document.querySelectorAll(".btn");
  const shimmerTimers = new WeakMap();
  const hoveredButtons = new WeakSet();

  const getShimmerDurationMs = (btn) => {
    const raw = getComputedStyle(btn).getPropertyValue("--shimmer-duration").trim();
    const match = raw.match(/^([\d.]+)(ms|s)$/);
    if (!match) return 1400;
    const value = Number(match[1]);
    return match[2] === "ms" ? value : value * 1000;
  };

  const startShimmer = (btn) => {
    // If the shimmer is already running, let it finish (don't restart).
    if (shimmerTimers.has(btn) || btn.classList.contains("shimmer-active")) return;

    btn.classList.remove("shimmer-active");
    void btn.offsetWidth;
    btn.classList.add("shimmer-active");
    const duration = getShimmerDurationMs(btn);
    const timer = window.setTimeout(() => {
      btn.classList.remove("shimmer-active");
      shimmerTimers.delete(btn);

      if (hoveredButtons.has(btn)) startShimmer(btn);
    }, duration);
    shimmerTimers.set(btn, timer);
  };

  for (const btn of shimmerButtons) {
    if (!(btn instanceof HTMLElement)) continue;
    btn.addEventListener("mouseenter", () => {
      hoveredButtons.add(btn);
      startShimmer(btn);
    });
    btn.addEventListener("mouseleave", () => {
      hoveredButtons.delete(btn);
    });
    btn.addEventListener("focusin", () => startShimmer(btn));
  }

  applyLanguage(lang);
})();
