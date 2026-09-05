(function () {
  "use strict";

  function initializeArtworkMotion() {
    var body = document.body;
    var portraits = Array.prototype.slice.call(document.querySelectorAll("[data-portrait-motion]"));
    var covers = Array.prototype.slice.call(document.querySelectorAll("[data-cover-motion]"));
    var toggles = Array.prototype.slice.call(document.querySelectorAll("[data-art-motion-toggle]"));

    // Without the complete enhancement, the artwork and ordinary page stay still.
    if (!body || body.classList.contains("art-motion-ready") ||
        (!portraits.length && !covers.length) || !toggles.length ||
        typeof window.matchMedia !== "function" ||
        typeof window.IntersectionObserver !== "function") return;

    var preference;
    var observer;
    var reducedMotion;
    var manuallyPaused = false;
    var coverFrame = null;
    var supportsParallax = typeof window.requestAnimationFrame === "function" &&
      typeof window.cancelAnimationFrame === "function";

    function documentIsHidden() {
      return document.visibilityState === "hidden";
    }

    function cancelCoverFrame() {
      if (coverFrame !== null) window.cancelAnimationFrame(coverFrame);
      coverFrame = null;
    }

    function updateCoverParallax() {
      // Keep the last visual position while the tab is hidden.
      if (documentIsHidden()) return;
      covers.forEach(function (cover) {
        var offset = 0;
        if (supportsParallax && !reducedMotion && !manuallyPaused) {
          var rect = cover.getBoundingClientRect();
          var distance = window.innerHeight / 2 - (rect.top + rect.height / 2);
          offset = Math.max(-40, Math.min(40, distance * 0.18));
          offset = Math.round(offset * 100) / 100;
        }
        cover.style.setProperty("--cover-parallax-y", offset + "px");
      });
    }

    function queueCoverParallax() {
      if (!supportsParallax || !covers.length || coverFrame !== null ||
          reducedMotion || manuallyPaused || documentIsHidden()) return;
      coverFrame = window.requestAnimationFrame(function () {
        coverFrame = null;
        updateCoverParallax();
      });
    }

    function refreshPortraitVisibility() {
      portraits.forEach(function (portrait) {
        var rect = portrait.getBoundingClientRect();
        portrait.dataset.motionVisible = String(rect.bottom > 0 && rect.top < window.innerHeight);
      });
    }

    function updateMotionState() {
      var paused = reducedMotion || manuallyPaused;
      body.dataset.artMotionState = paused || documentIsHidden() ? "paused" : "running";
      toggles.forEach(function (toggle) {
        toggle.disabled = reducedMotion;
        toggle.setAttribute("aria-pressed", String(paused));
        toggle.setAttribute("aria-label", reducedMotion ? "Motion reduced" :
          manuallyPaused ? "Resume artwork motion" : "Pause artwork motion");
        toggle.textContent = reducedMotion ? "Motion reduced" :
          manuallyPaused ? "Resume motion" : "Pause motion";
      });
      cancelCoverFrame();
      updateCoverParallax();
    }

    try {
      preference = window.matchMedia("(prefers-reduced-motion: reduce)");
      if (typeof preference.addEventListener !== "function" &&
          typeof preference.addListener !== "function") return;
      reducedMotion = Boolean(preference.matches);
      observer = new window.IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (portraits.indexOf(entry.target) !== -1) {
            entry.target.dataset.motionVisible = String(entry.isIntersecting);
          }
        });
      }, { threshold: 0 });
      portraits.forEach(function (portrait) { observer.observe(portrait); });
      refreshPortraitVisibility();
    } catch (error) {
      if (observer) observer.disconnect();
      return;
    }

    updateMotionState();
    body.classList.add("art-motion-ready");
    // Enhanced spacing and visible controls can change the initial artwork bounds.
    refreshPortraitVisibility();
    updateCoverParallax();

    toggles.forEach(function (toggle) {
      toggle.addEventListener("click", function () {
        if (reducedMotion) return;
        manuallyPaused = !manuallyPaused;
        refreshPortraitVisibility();
        updateMotionState();
      });
    });

    function onPreferenceChange() {
      reducedMotion = Boolean(preference.matches);
      refreshPortraitVisibility();
      updateMotionState();
    }
    if (typeof preference.addEventListener === "function") {
      preference.addEventListener("change", onPreferenceChange);
    } else {
      preference.addListener(onPreferenceChange);
    }

    document.addEventListener("visibilitychange", function () {
      if (!documentIsHidden()) refreshPortraitVisibility();
      updateMotionState();
    });

    window.addEventListener("resize", function () {
      refreshPortraitVisibility();
      updateMotionState();
    });

    // Scroll schedules one update per paint, with no perpetual JavaScript loop.
    if (supportsParallax && covers.length) {
      window.addEventListener("scroll", queueCoverParallax, { passive: true });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initializeArtworkMotion, { once: true });
  } else {
    initializeArtworkMotion();
  }
}());
