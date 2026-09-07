(function () {
  "use strict";

  function initializeHomeExperience() {
    var body = document.body;
    var header = document.getElementById("home-header");
    var reveal = document.getElementById("header-reveal");
    var hide = document.getElementById("header-hide");
    var hero = document.querySelector(".hero-immersive");
    var motionToggle = document.getElementById("hero-motion-toggle");
    var heroVideo = document.getElementById("hero-video");

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
    var videoLayout;
    var compactNavigation;
    var videoFailed = false;
    var videoPlayPending = false;
    var videoRequest = 0;
    var heroVisible;
    var manuallyPaused = false;
    var headerHovered = false;
    var revealHovered = false;
    var suppressRevealFocus = false;
    var suppressRevealPointer = false;
    var hideTimer = null;
    var introDelay = null;
    var introLinger = null;
    var parallaxFrame = null;
    var supportsParallax = typeof window.requestAnimationFrame === "function" &&
      typeof window.cancelAnimationFrame === "function";

    function updateParallax() {
      if (!supportsParallax || document.visibilityState === "hidden") return;
      var offset = 0;
      if (!reducedMotion && !manuallyPaused) {
        var rect = hero.getBoundingClientRect();
        var distance = Math.max(0, Math.min(-rect.top, rect.height));
        // The words scroll normally; the faces travel at 36% of their speed.
        offset = Math.round(distance * 0.64 * 100) / 100;
      }
      body.style.setProperty("--hero-parallax-y", offset + "px");
    }

    function queueParallax() {
      if (!supportsParallax || parallaxFrame !== null || reducedMotion || manuallyPaused ||
          document.visibilityState === "hidden") return;
      parallaxFrame = window.requestAnimationFrame(function () {
        parallaxFrame = null;
        updateParallax();
      });
    }

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
      if (reducedMotion || !heroVisible || (compactNavigation && compactNavigation.matches)) shown = true;
      body.dataset.headerState = shown ? "shown" : "hidden";
      header.inert = !shown;
      reveal.setAttribute("aria-expanded", String(shown));
    }

    function videoIsAllowed() {
      var connection = window.navigator && window.navigator.connection;
      return heroVideo && videoLayout && !reducedMotion &&
        !videoFailed && !(connection && connection.saveData);
    }

    function showVideoFallback() {
      body.dataset.heroVideo = "fallback";
      if (heroVideo) heroVideo.pause();
    }

    function updateVideo(paused) {
      if (!heroVideo) return;
      // Load just the appropriate clip. Reduced-motion and data-saving
      // visitors keep the original art-directed picture without a download.
      body.dataset.heroVideoLayout = videoLayout && videoLayout.matches ? "desktop" : "mobile";
      if (!videoIsAllowed()) {
        showVideoFallback();
        return;
      }
      if (paused) {
        heroVideo.pause();
        return;
      }
      var source = videoLayout.matches ? heroVideo.dataset.src : heroVideo.dataset.mobileSrc;
      if (heroVideo.getAttribute("src") !== source) {
        videoRequest++;
        videoPlayPending = false;
        showVideoFallback();
        heroVideo.src = source;
      }
      if (!heroVideo.paused || videoPlayPending) return;
      heroVideo.muted = true;
      videoPlayPending = true;
      var request = ++videoRequest;
      try {
        var playback = heroVideo.play();
        if (playback && typeof playback.then === "function") {
          playback.then(function () {
            if (request !== videoRequest) return;
            videoPlayPending = false;
            if (!videoIsAllowed() || body.dataset.motionState !== "running") heroVideo.pause();
          }).catch(function (error) {
            if (request !== videoRequest) return;
            videoPlayPending = false;
            // A quick pause while loading can legitimately abort play().
            if (error && error.name === "AbortError") {
              if (videoIsAllowed() && body.dataset.motionState === "running") updateVideo(false);
              return;
            }
            videoFailed = true;
            showVideoFallback();
          });
        } else {
          videoPlayPending = false;
        }
      } catch (error) {
        videoPlayPending = false;
        videoFailed = true;
        showVideoFallback();
      }
    }

    function updateMotion() {
      var paused = reducedMotion || manuallyPaused || !heroVisible || document.visibilityState === "hidden";
      body.dataset.heroVisible = String(heroVisible);
      body.dataset.motionState = paused ? "paused" : "running";
      updateVideo(paused);
      motionToggle.disabled = reducedMotion;
      motionToggle.setAttribute("aria-pressed", String(reducedMotion || manuallyPaused));
      motionToggle.setAttribute("aria-label", reducedMotion ? "Motion reduced" :
        manuallyPaused ? "Resume background motion" : "Pause background motion");
      motionToggle.textContent = reducedMotion ? "Motion reduced" : manuallyPaused ? "Resume motion" : "Pause motion";
      if (parallaxFrame !== null) window.cancelAnimationFrame(parallaxFrame);
      parallaxFrame = null;
      updateParallax();
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
      if (reducedMotion || !heroVisible || compactNavigation.matches) return;
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
      compactNavigation = window.matchMedia("(max-width: 900px)");
      if (heroVideo && typeof heroVideo.play === "function" && typeof heroVideo.pause === "function") {
        // Shape, not device width, determines the composition. A sideways
        // phone needs the wider clip just as a landscape desktop does.
        videoLayout = window.matchMedia("(min-aspect-ratio: 6/5)");
      } else {
        heroVideo = null;
      }
      observeHero();
      heroVisible = heroIsVisible(hero.getBoundingClientRect());
    } catch (error) {
      if (observer) observer.disconnect();
      return;
    }

    if (heroVideo) {
      heroVideo.addEventListener("playing", function () {
        if (!videoIsAllowed() || body.dataset.motionState !== "running") {
          heroVideo.pause();
          return;
        }
        // Reveal only decoded, playing frames; the original image is always
        // underneath if loading, playback policy, or the network fails.
        body.dataset.heroVideo = "ready";
      });
      heroVideo.addEventListener("error", function () {
        videoFailed = true;
        showVideoFallback();
      });
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

    // Scroll events schedule at most one paint update, never a continuous JS loop.
    if (supportsParallax) window.addEventListener("scroll", queueParallax, { passive: true });

    window.addEventListener("resize", function () {
      try {
        setHeaderShown(body.dataset.headerState === "shown");
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
    if (!reducedMotion && !compactNavigation.matches && heroVisible && window.scrollY <= 16 &&
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
