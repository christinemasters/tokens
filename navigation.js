(function () {
  "use strict";
  var header = document.querySelector(".site-header");
  var nav = header && header.querySelector("nav");
  if (!nav || typeof window.matchMedia !== "function") return;
  var compact = window.matchMedia("(max-width: 900px)");
  var toggle = document.createElement("button");
  nav.id = "site-navigation";
  toggle.id = "site-menu-toggle";
  toggle.className = "site-menu-toggle";
  toggle.type = "button";
  toggle.setAttribute("aria-controls", nav.id);
  header.insertBefore(toggle, nav);
  var open = false;

  function render() {
    nav.hidden = compact.matches && !open;
    toggle.hidden = !compact.matches;
    toggle.setAttribute("aria-expanded", String(compact.matches && open));
    toggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
    toggle.textContent = open ? "Close" : "Menu";
    header.dataset.menuOpen = String(compact.matches && open);
  }

  toggle.addEventListener("click", function () { open = !open; render(); });
  document.addEventListener("keydown", function (event) {
    if (event.key !== "Escape" || !compact.matches || !open) return;
    event.preventDefault();
    open = false;
    render();
    toggle.focus({ preventScroll: true });
  });
  document.addEventListener("click", function (event) {
    if (compact.matches && open && !header.contains(event.target)) { open = false; render(); }
  });
  nav.addEventListener("click", function (event) {
    var link = event.target.closest("a");
    if (!link || !compact.matches) return;
    open = false;
    render();
    // Do not leave keyboard focus inside the now-hidden panel.
    toggle.focus({ preventScroll: true });
  });
  header.addEventListener("focusout", function (event) {
    if (compact.matches && open && !header.contains(event.relatedTarget)) { open = false; render(); }
  });
  function resize() {
    var restoreFocus = compact.matches && nav.contains(document.activeElement);
    open = false;
    render();
    if (restoreFocus) toggle.focus({ preventScroll: true });
  }
  if (typeof compact.addEventListener === "function") compact.addEventListener("change", resize);
  else if (typeof compact.addListener === "function") compact.addListener(resize);
  render();
  document.body.classList.add("site-nav-ready");
})();
