(function () {
  "use strict";

  function initializeSound() {
    var control = document.getElementById("sound-control");
    var button = document.getElementById("sound-toggle");
    var label = document.getElementById("sound-label");
    var status = document.getElementById("sound-status");
    var music = document.getElementById("background-music");
    if (!control || !button || !label || !status || !music ||
        typeof music.play !== "function" || typeof music.pause !== "function" ||
        !music.dataset.src || control.dataset.soundReady === "true") return;

    var requested = false;
    var pageActive = true;
    var pending = false;
    var requestId = 0;
    var startTimer = null;

    function allowed() {
      return requested && pageActive && document.visibilityState !== "hidden";
    }

    function clearStartTimer() {
      if (startTimer !== null) window.clearTimeout(startTimer);
      startTimer = null;
    }

    function render(state, message) {
      control.dataset.sound = state;
      button.setAttribute("aria-pressed", String(requested));
      button.setAttribute("aria-label", requested ? "Turn background music off" : "Turn background music on");
      button.title = requested ? "Turn off The Gap Between Seconds" : "Play The Gap Between Seconds";
      label.textContent = state === "on" ? "Sound on" : state === "loading" ? "Loading" : state === "paused" ? "Sound paused" : "Sound off";
      status.textContent = message || "";
    }

    function suspend() {
      requestId++;
      pending = false;
      clearStartTimer();
      music.pause();
      render(requested ? "paused" : "off");
    }

    function fail() {
      requested = false;
      suspend();
      render("error", "The music could not start. Tap the sound button to try again.");
    }

    function start() {
      if (!allowed()) { suspend(); return; }
      if (pending || !music.paused) return;
      pending = true;
      var id = ++requestId;
      render("loading", "Starting background music.");
      startTimer = window.setTimeout(function () { if (id === requestId) fail(); }, 12000);
      try {
        // No source, download, or audible playback until an explicit click.
        if (!music.getAttribute("src")) music.src = music.dataset.src;
        else if (music.error && typeof music.load === "function") music.load();
        var playback = music.play();
        if (playback && typeof playback.then === "function") {
          playback.then(function () {
            if (id !== requestId) return;
            pending = false;
            clearStartTimer();
            if (!allowed()) { suspend(); return; }
            if (music.paused) { requested = false; render("off"); return; }
            render("on", "Background music on.");
          }).catch(function () { if (id === requestId) fail(); });
        }
      } catch (_) { if (id === requestId) fail(); }
    }

    button.addEventListener("click", function () {
      requested = !requested;
      if (requested) start();
      else { suspend(); status.textContent = "Background music off."; }
    });

    music.addEventListener("playing", function () {
      if (!allowed()) { music.pause(); return; }
      pending = false;
      clearStartTimer();
      render("on", "Background music on.");
    });

    music.addEventListener("pause", function () {
      if (!music.paused || pending || !allowed()) return;
      // Respect an OS/media-key interruption instead of fighting it.
      requested = false;
      suspend();
    });

    music.addEventListener("error", function () { if (requested) fail(); });
    document.addEventListener("visibilitychange", function () {
      if (allowed()) start();
      else suspend();
    });
    window.addEventListener("pagehide", function () { pageActive = false; requested = false; suspend(); });
    window.addEventListener("pageshow", function () { pageActive = true; });

    // Every visit starts off. No saved opt-in, analytics, or autoplay attempts.
    try { music.volume = 0.35; } catch (_) { /* Some devices use hardware volume only. */ }
    music.pause();
    render("off");
    control.dataset.soundReady = "true";
    control.hidden = false;
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initializeSound, { once: true });
  else initializeSound();
})();
