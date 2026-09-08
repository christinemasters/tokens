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
    var pageActive = true;
    var videos = [];
    var coverFrame = null;
    var supportsParallax = typeof window.requestAnimationFrame === "function" &&
      typeof window.cancelAnimationFrame === "function";

    function documentIsHidden() {
      return !pageActive || document.visibilityState === "hidden";
    }

    function videoIsAllowed(record) {
      var connection = window.navigator && window.navigator.connection;
      return !record.failed && !reducedMotion && !(connection && connection.saveData);
    }

    function videoShouldPlay(record) {
      return videoIsAllowed(record) && !manuallyPaused && !documentIsHidden() &&
        record.portrait.dataset.motionVisible === "true";
    }

    function clearVideoTimer(record) {
      if (record.timer !== null) window.clearTimeout(record.timer);
      record.timer = null;
    }

    function pauseVideo(record) {
      record.request++;
      record.pending = false;
      clearVideoTimer(record);
      record.video.pause();
    }

    function failVideo(record) {
      record.failed = true;
      pauseVideo(record);
      record.portrait.dataset.portraitVideo = "fallback";
    }

    function updateVideo(record) {
      if (!videoShouldPlay(record)) {
        pauseVideo(record);
        if (!videoIsAllowed(record)) record.portrait.dataset.portraitVideo = "fallback";
        return;
      }
      if (record.pending || !record.video.paused) return;
      record.pending = true;
      var request = ++record.request;
      // A slow or unavailable clip never replaces the working still portrait.
      record.timer = window.setTimeout(function () {
        if (request === record.request) failVideo(record);
      }, 12000);
      try {
        record.video.muted = true;
        if (!record.video.getAttribute("src")) record.video.src = record.video.dataset.src;
        var playback = record.video.play();
        if (playback && typeof playback.then === "function") {
          playback.then(function () {
            if (request !== record.request) return;
            if (!videoShouldPlay(record)) pauseVideo(record);
          }).catch(function () { if (request === record.request) failVideo(record); });
        }
      } catch (_) { if (request === record.request) failVideo(record); }
    }

    function updateVideos() { videos.forEach(updateVideo); }

    function prepareVideos() {
      portraits.forEach(function (portrait) {
        var video = typeof portrait.querySelector === "function" && portrait.querySelector("video[data-src]");
        if (!video || !video.dataset.src || typeof video.play !== "function" ||
            typeof video.pause !== "function") return;
        var record = { portrait: portrait, video: video, failed: false, pending: false, request: 0, timer: null };
        videos.push(record);
        video.addEventListener("playing", function () {
          if (!videoShouldPlay(record)) { pauseVideo(record); return; }
          record.pending = false;
          clearVideoTimer(record);
          portrait.dataset.portraitVideo = "ready";
        });
        video.addEventListener("error", function () { failVideo(record); });
      });
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
      updateVideos();
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
        updateVideos();
      }, { threshold: 0 });
      portraits.forEach(function (portrait) { observer.observe(portrait); });
      refreshPortraitVisibility();
    } catch (error) {
      if (observer) observer.disconnect();
      return;
    }

    prepareVideos();
    updateMotionState();
    body.classList.add("art-motion-ready");
    // Enhanced spacing and visible controls can change the initial artwork bounds.
    refreshPortraitVisibility();
    updateCoverParallax();
    updateVideos();

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

    window.addEventListener("pagehide", function () {
      pageActive = false;
      updateMotionState();
    });
    window.addEventListener("pageshow", function () {
      pageActive = true;
      refreshPortraitVisibility();
      updateMotionState();
    });

    var connection = window.navigator && window.navigator.connection;
    if (videos.length && connection && typeof connection.addEventListener === "function") {
      connection.addEventListener("change", updateVideos);
    }

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
