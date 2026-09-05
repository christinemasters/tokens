(function () {
  "use strict";

  function initializeHomeExperience() {
    var body = document.body;
    var header = document.getElementById("home-header");
    var reveal = document.getElementById("header-reveal");
    var hide = document.getElementById("header-hide");
    var hero = document.querySelector(".hero-immersive");
    var motionToggle = document.getElementById("hero-motion-toggle");

    // An unsupported or incomplete page keeps its ordinary, visible navigation.
    if (!body || !body.classList.contains("home-page") ||
        body.classList.contains("home-experience-ready") ||
        !header || !reveal || !hide || !hero || !motionToggle ||
        !("inert" in header) || typeof window.matchMedia !== "function" ||
        typeof window.IntersectionObserver !== "function") return;

    var preference;
    var observer;
    var observerEdge;
    var reducedMotion;
    var heroVisible;
    var manuallyPaused = false;
    var headerHovered = false;
    var revealHovered = false;
    var suppressRevealFocus = false;
    var suppressRevealPointer = false;
    var hideTimer = null;
    var introDelay = null;
    var introLinger = null;

    function headerEdge() {
      var height = Math.max(0, header.getBoundingClientRect().height);
      body.style.setProperty("--home-header-height", height + "px");
      return height + 24;
    }

    function heroIsVisible(rect) {
      return rect.bottom > observerEdge && rect.top < window.innerHeight;
    }

    function headerHasFocus() {
      return header.contains(document.activeElement);
    }

    function pointerKeepsHeaderOpen() {
      return headerHovered || revealHovered;
    }

    function clearHideTimer() {
      if (hideTimer !== null) window.clearTimeout(hideTimer);
      hideTimer = null;
    }

    function cancelIntro() {
      if (introDelay !== null) window.clearTimeout(introDelay);
      if (introLinger !== null) window.clearTimeout(introLinger);
      introDelay = null;
      introLinger = null;
    }

    function setHeaderShown(shown) {
      // Navigation never disappears below the hero or under reduced motion.
      if (reducedMotion || !heroVisible) shown = true;
      body.dataset.headerState = shown ? "shown" : "hidden";
      header.inert = !shown;
      reveal.setAttribute("aria-expanded", String(shown));
    }

    function updateMotion() {
      var paused = reducedMotion || manuallyPaused || !heroVisible || document.visibilityState === "hidden";
      body.dataset.heroVisible = String(heroVisible);
      body.dataset.motionState = paused ? "paused" : "running";
      motionToggle.disabled = reducedMotion;
      motionToggle.setAttribute("aria-pressed", String(reducedMotion || manuallyPaused));
      motionToggle.setAttribute("aria-label", reducedMotion ? "Motion reduced" :
        manuallyPaused ? "Resume background motion" : "Pause background motion");
      motionToggle.textContent = reducedMotion ? "Motion reduced" : manuallyPaused ? "Resume motion" : "Pause motion";
    }

    function scheduleHide() {
      clearHideTimer();
      if (reducedMotion || !heroVisible) return;
      hideTimer = window.setTimeout(function () {
        hideTimer = null;
        if (!headerHasFocus() && !pointerKeepsHeaderOpen()) setHeaderShown(false);
      }, 500);
    }

    function openFromInteraction() {
      suppressRevealPointer = false;
      cancelIntro();
      clearHideTimer();
      setHeaderShown(true);
    }

    function closeExplicitly() {
      if (reducedMotion || !heroVisible) return;
      cancelIntro();
      clearHideTimer();
      headerHovered = false;
      revealHovered = false;
      // Hiding the header can expose its trigger under a stationary pointer.
      // Wait for a genuine re-entry, click, or keyboard focus before reopening.
      suppressRevealPointer = true;
      setHeaderShown(false);
      // Returning keyboard focus must not trigger the reveal control's opener.
      suppressRevealFocus = true;
      try { reveal.focus({ preventScroll: true }); }
      finally { suppressRevealFocus = false; }
      clearHideTimer();
    }

    function updateHeroVisibility(visible) {
      if (visible === heroVisible) {
        updateMotion();
        return;
      }
      heroVisible = visible;
      cancelIntro();
      clearHideTimer();
      setHeaderShown(!heroVisible || headerHasFocus() || pointerKeepsHeaderOpen());
      updateMotion();
    }

    function observeHero() {
      observerEdge = headerEdge();
      var nextObserver = new window.IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.target === hero) updateHeroVisibility(entry.isIntersecting && heroIsVisible(entry.boundingClientRect));
        });
      }, { rootMargin: "-" + observerEdge + "px 0px 0px 0px", threshold: 0 });
      if (observer) observer.disconnect();
      observer = nextObserver;
      observer.observe(hero);
    }

    try {
      preference = window.matchMedia("(prefers-reduced-motion: reduce)");
      if (typeof preference.addEventListener !== "function" && typeof preference.addListener !== "function") return;
      reducedMotion = preference.matches;
      observeHero();
      heroVisible = heroIsVisible(hero.getBoundingClientRect());
    } catch (error) {
      if (observer) observer.disconnect();
      return;
    }

    setHeaderShown(reducedMotion || !heroVisible || headerHasFocus());
    updateMotion();
    body.classList.add("home-experience-ready");
    // Enhanced navigation can be taller on narrow layouts than its static fallback.
    observeHero();
    updateHeroVisibility(heroIsVisible(hero.getBoundingClientRect()));

    reveal.addEventListener("pointerenter", function (event) {
      if (event.pointerType === "touch" || suppressRevealPointer) return;
      revealHovered = true;
      openFromInteraction();
    });
    reveal.addEventListener("pointerleave", function (event) {
      if (event.pointerType === "touch") return;
      revealHovered = false;
      suppressRevealPointer = false;
      scheduleHide();
    });
    reveal.addEventListener("focus", function () {
      if (!suppressRevealFocus) openFromInteraction();
    });
    reveal.addEventListener("click", openFromInteraction);

    header.addEventListener("pointerenter", function (event) {
      if (event.pointerType === "touch" ||
          (suppressRevealPointer && body.dataset.headerState === "hidden")) return;
      headerHovered = true;
      openFromInteraction();
    });
    header.addEventListener("pointerleave", function (event) {
      if (event.pointerType === "touch") return;
      headerHovered = false;
      scheduleHide();
    });
    header.addEventListener("focusin", openFromInteraction);
    header.addEventListener("focusout", scheduleHide);
    hide.addEventListener("click", closeExplicitly);
    document.addEventListener("keydown", function (event) {
      if (event.defaultPrevented || event.key !== "Escape" || body.dataset.headerState !== "shown" ||
          reducedMotion || !heroVisible) return;
      event.preventDefault();
      closeExplicitly();
    });

    motionToggle.addEventListener("click", function () {
      if (reducedMotion) return;
      manuallyPaused = !manuallyPaused;
      updateMotion();
    });

    function onPreferenceChange() {
      reducedMotion = preference.matches;
      cancelIntro();
      clearHideTimer();
      setHeaderShown(reducedMotion || !heroVisible || headerHasFocus() || pointerKeepsHeaderOpen());
      updateMotion();
    }
    if (typeof preference.addEventListener === "function") {
      preference.addEventListener("change", onPreferenceChange);
    } else {
      preference.addListener(onPreferenceChange);
    }

    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden") {
        cancelIntro();
        clearHideTimer();
        if (!headerHasFocus() && !pointerKeepsHeaderOpen()) setHeaderShown(false);
      }
      updateMotion();
    });

    window.addEventListener("resize", function () {
      try {
        observeHero();
        updateHeroVisibility(heroIsVisible(hero.getBoundingClientRect()));
      } catch (error) {
        // A failed observer must not strand the navigation or leave unseen motion running.
        if (observer) observer.disconnect();
        cancelIntro();
        clearHideTimer();
        heroVisible = false;
        setHeaderShown(true);
        updateMotion();
      }
    });

    // The introduction runs once, only for an initial, visible landing on the hero.
    if (!reducedMotion && heroVisible && window.scrollY <= 16 &&
        document.visibilityState !== "hidden" && !headerHasFocus()) {
      introDelay = window.setTimeout(function () {
        introDelay = null;
        if (reducedMotion || !heroVisible || document.visibilityState === "hidden") return;
        setHeaderShown(true);
        introLinger = window.setTimeout(function () {
          introLinger = null;
          if (!headerHasFocus() && !pointerKeepsHeaderOpen()) setHeaderShown(false);
        }, 4000);
      }, 3000);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initializeHomeExperience, { once: true });
  } else {
    initializeHomeExperience();
  }
})();
