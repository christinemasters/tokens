const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const script = readFileSync(path.join(root, "hero-motion.js"), "utf8");

class Events {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, fn, options) {
    const listeners = this.listeners.get(type) || [];
    listeners.push({ fn, once: Boolean(options && options.once), passive: Boolean(options && options.passive) });
    this.listeners.set(type, listeners);
  }
  fire(type, details = {}) {
    const event = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...details };
    for (const listener of [...(this.listeners.get(type) || [])]) {
      if (listener.once) this.listeners.set(type, this.listeners.get(type).filter((item) => item !== listener));
      listener.fn(event);
    }
    return event;
  }
}

function browser(options = {}) {
  const document = new Events();
  document.readyState = options.loading ? "loading" : "complete";
  document.visibilityState = options.hidden ? "hidden" : "visible";
  class Element extends Events {
    constructor(id) {
      super();
      this.id = id;
      this.attributes = {};
      this.dataset = {};
      const properties = new Map();
      this.style = {
        setProperty(name, value) { properties.set(name, String(value)); },
        getPropertyValue(name) { return properties.get(name) || ""; },
      };
      this.disabled = false;
      this.textContent = "";
      this.inert = false;
      this.classes = new Set();
      this.classList = {
        contains: (name) => this.classes.has(name),
        add: (name) => this.classes.add(name),
        remove: (name) => this.classes.delete(name),
      };
      this.rect = { top: 0, bottom: 900, height: 900 };
    }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    getAttribute(name) { return this.attributes[name] ?? null; }
    getBoundingClientRect() { return this.rect; }
    contains(element) {
      while (element) {
        if (element === this) return true;
        element = element.parent;
      }
      return false;
    }
    focus() {
      if (document.activeElement === this) return;
      const previous = document.activeElement;
      document.activeElement = this;
      for (let element = previous; element; element = element.parent) element.fire("focusout", { relatedTarget: this });
      this.fire("focus");
      for (let element = this; element; element = element.parent) element.fire("focusin", { relatedTarget: previous });
    }
  }
  const body = new Element("body");
  if (!options.notHome) body.classList.add("home-page");
  const elements = new Map(["home-header", "header-reveal", "header-hide", "hero-motion-toggle", "hero", "nav-link"]
    .map((id) => [id, new Element(id)]));
  const el = (id) => elements.get(id);
  for (const element of elements.values()) element.parent = body;
  el("header-hide").parent = el("home-header");
  el("nav-link").parent = el("home-header");
  el("home-header").rect = { top: 0, bottom: 80, height: 80 };
  if (options.offHero) el("hero").rect = { top: -1000, bottom: -100, height: 900 };
  if (options.noInert) delete el("home-header").inert;
  document.body = body;
  document.activeElement = options.focusedHeader ? el("nav-link") : body;
  document.getElementById = (id) => id === options.missing ? null : el(id);
  document.querySelector = (selector) => selector === ".hero-immersive" && !options.noHero ? el("hero") : null;

  const timers = new Map();
  const frames = new Map();
  let time = 0;
  let nextId = 0;
  const window = new Events();
  window.innerHeight = 900;
  window.scrollY = options.scrollY || 0;
  window.setTimeout = (fn, delay) => { const id = ++nextId; timers.set(id, { fn, at: time + delay }); return id; };
  window.clearTimeout = (id) => timers.delete(id);
  if (!options.noAnimationFrame) {
    window.requestAnimationFrame = (fn) => { const id = ++nextId; frames.set(id, fn); return id; };
    if (!options.noCancelAnimationFrame) window.cancelAnimationFrame = (id) => frames.delete(id);
  }
  const preference = new Events();
  preference.matches = Boolean(options.reduced);
  if (options.legacyPreference) {
    preference.addListener = (fn) => Events.prototype.addEventListener.call(preference, "change", fn);
    preference.addEventListener = undefined;
  }
  if (options.noPreferenceEvents) {
    preference.addEventListener = undefined;
    preference.addListener = undefined;
  }
  if (!options.noMatchMedia) window.matchMedia = () => preference;
  const observers = [];
  if (!options.noObserver) window.IntersectionObserver = class {
    constructor(callback, settings) {
      if (options.observerThrows) throw new Error("Observer unavailable");
      this.callback = callback;
      this.settings = settings;
      observers.push(this);
    }
    observe(target) { this.target = target; }
    disconnect() { this.disconnected = true; }
  };

  const run = () => vm.runInNewContext(script, { document, window }, { filename: "hero-motion.js" });
  if (options.run !== false) run();
  return {
    body, el, document, window, preference, timers, frames, observers, run,
    flushFrames() {
      const pending = [...frames];
      frames.clear();
      for (const [, fn] of pending) fn(time);
    },
    tick(milliseconds) {
      const end = time + milliseconds;
      let iterations = 0;
      while (true) {
        const next = [...timers].sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
        if (!next || next[1].at > end) break;
        assert.ok(++iterations < 100, "Timers must remain bounded");
        time = next[1].at;
        timers.delete(next[0]);
        next[1].fn();
      }
      time = end;
    },
    intersection(visible) {
      const hero = el("hero");
      hero.rect = visible ? { top: 0, bottom: 900, height: 900 } : { top: -1000, bottom: -100, height: 900 };
      observers.at(-1).callback([{ target: hero, isIntersecting: visible, boundingClientRect: hero.rect }]);
    },
    reduce(value) { preference.matches = value; preference.fire("change", { matches: value }); },
    visibility(value) { document.visibilityState = value; document.fire("visibilitychange"); },
  };
}

function assertHeader(view, state) {
  assert.equal(view.body.dataset.headerState, state);
  assert.equal(view.el("home-header").inert, state === "hidden");
  assert.equal(view.el("header-reveal").getAttribute("aria-expanded"), String(state === "shown"));
}

test("HTML keeps navigation usable without JavaScript and enhancement-only controls are CSS-gated", () => {
  const html = readFileSync(path.join(root, "index.html"), "utf8");
  const css = readFileSync(path.join(root, "hero-motion.css"), "utf8");
  const body = html.match(/<body\b[^>]*>/)?.[0];
  const header = html.match(/<header\b[^>]*\bid="home-header"[^>]*>/)?.[0];
  assert.ok(header, "The script header must exist in the real markup");
  assert.doesNotMatch(header, /\b(?:inert|hidden)(?:\s|=|>)|aria-hidden="true"/);
  assert.doesNotMatch(body, /home-experience-ready|data-header-state/);
  for (const id of ["header-reveal", "header-hide", "hero-motion-toggle"]) {
    assert.match(html, new RegExp(`<button\\b[^>]*id="${id}"[^>]*type="button"`));
  }
  assert.match(css, /\.home-page\s+\.header-reveal,[\s\S]*?\.home-page\s+\.hero-motion-toggle\s*\{\s*display:\s*none/);
  assert.match(css, /\.home-page\.home-experience-ready\[data-header-state="hidden"\]\s+\.site-header\s*\{/);
  assert.match(css, /\.home-page\s+\.site-header\s+nav\s*\{[^}]*display:\s*grid/);
});

test("top landing begins hidden, reveals after three seconds, and hides four seconds later", () => {
  const view = browser();
  assert.equal(view.body.classList.contains("home-experience-ready"), true);
  assertHeader(view, "hidden");
  assert.equal(view.body.dataset.motionState, "running");
  view.tick(2999);
  assertHeader(view, "hidden");
  view.tick(1);
  assertHeader(view, "shown");
  view.tick(3999);
  assertHeader(view, "shown");
  view.tick(1);
  assertHeader(view, "hidden");
  view.tick(60000);
  assertHeader(view, "hidden");
  assert.equal(view.timers.size, 0, "The introduction must not loop");
});

test("hover reveals navigation, pins it open, and allows a short pointer transfer grace period", () => {
  const view = browser();
  view.el("header-reveal").fire("pointerenter", { pointerType: "mouse" });
  assertHeader(view, "shown");
  view.tick(10000);
  assertHeader(view, "shown");
  view.el("header-reveal").fire("pointerleave", { pointerType: "mouse" });
  view.tick(250);
  view.el("home-header").fire("pointerenter", { pointerType: "mouse" });
  view.tick(10000);
  assertHeader(view, "shown");
  view.el("home-header").fire("pointerleave", { pointerType: "mouse" });
  view.tick(499);
  assertHeader(view, "shown");
  view.tick(1);
  assertHeader(view, "hidden");
});

test("keyboard focus reveals navigation and prevents idle hiding until focus leaves", () => {
  const view = browser();
  view.el("header-reveal").focus();
  assertHeader(view, "shown");
  view.el("nav-link").focus();
  view.el("home-header").fire("pointerleave", { pointerType: "mouse" });
  view.tick(10000);
  assertHeader(view, "shown");
  view.body.focus();
  view.tick(500);
  assertHeader(view, "hidden");
});

for (const close of ["Escape", "Hide"]) {
  test(`${close} hides navigation and restores reveal focus without reopening`, () => {
    const view = browser();
    view.el("header-reveal").fire("click");
    view.el("nav-link").focus();
    if (close === "Escape") assert.equal(view.document.fire("keydown", { key: "Escape" }).defaultPrevented, true);
    else view.el("header-hide").fire("click");
    assertHeader(view, "hidden");
    assert.equal(view.document.activeElement, view.el("header-reveal"));
    view.tick(10000);
    assertHeader(view, "hidden");
    view.el("header-reveal").fire("click");
    assertHeader(view, "shown");
  });

  test(`${close} ignores a newly exposed Menu under a stationary pointer until it leaves and reenters`, () => {
    const view = browser();
    const reveal = view.el("header-reveal");
    reveal.fire("click");
    view.el("nav-link").focus();
    if (close === "Escape") view.document.fire("keydown", { key: "Escape" });
    else view.el("header-hide").fire("click");
    assertHeader(view, "hidden");
    view.el("home-header").fire("pointerenter", { pointerType: "mouse" });
    assertHeader(view, "hidden");
    reveal.fire("pointerenter", { pointerType: "mouse" });
    assertHeader(view, "hidden");
    view.tick(10000);
    assertHeader(view, "hidden");
    reveal.fire("pointerleave", { pointerType: "mouse" });
    view.tick(500);
    reveal.fire("pointerenter", { pointerType: "mouse" });
    assertHeader(view, "shown");
  });

  test(`a deliberate Menu click after ${close} reopens without requiring pointerleave`, () => {
    const view = browser();
    const reveal = view.el("header-reveal");
    reveal.fire("click");
    if (close === "Escape") view.document.fire("keydown", { key: "Escape" });
    else view.el("header-hide").fire("click");
    reveal.fire("pointerenter", { pointerType: "mouse" });
    assertHeader(view, "hidden");
    reveal.fire("click");
    assertHeader(view, "shown");
  });
}

test("fresh keyboard focus can reopen Menu after explicit closure without a pointerleave", () => {
  const view = browser();
  const reveal = view.el("header-reveal");
  reveal.fire("click");
  view.el("header-hide").fire("click");
  assertHeader(view, "hidden");
  view.body.focus();
  reveal.focus();
  assertHeader(view, "shown");
});

test("touch hover does not open navigation, but an explicit tap does", () => {
  const view = browser();
  view.el("header-reveal").fire("pointerenter", { pointerType: "touch" });
  assertHeader(view, "hidden");
  view.el("header-reveal").fire("click");
  assertHeader(view, "shown");
});

test("navigation is always shown below the hero, including after close attempts", () => {
  const view = browser({ offHero: true });
  assertHeader(view, "shown");
  assert.equal(view.body.dataset.heroVisible, "false");
  assert.equal(view.body.dataset.motionState, "paused");
  view.el("header-hide").fire("click");
  assert.equal(view.document.fire("keydown", { key: "Escape" }).defaultPrevented, false);
  view.el("home-header").fire("pointerleave", { pointerType: "mouse" });
  view.tick(10000);
  assertHeader(view, "shown");
  assert.equal(view.timers.size, 0);
});

test("leaving the hero cancels the introduction and pauses motion without replay on return", () => {
  const view = browser();
  view.tick(1000);
  view.intersection(false);
  assertHeader(view, "shown");
  assert.equal(view.body.dataset.motionState, "paused");
  view.tick(10000);
  view.intersection(true);
  assertHeader(view, "hidden");
  assert.equal(view.body.dataset.motionState, "running");
  view.tick(10000);
  assertHeader(view, "hidden");
});

test("document visibility pauses motion and cancels the introduction", () => {
  const view = browser();
  view.visibility("hidden");
  assert.equal(view.body.dataset.motionState, "paused");
  view.tick(10000);
  assertHeader(view, "hidden");
  view.visibility("visible");
  assert.equal(view.body.dataset.motionState, "running");
  view.tick(10000);
  assertHeader(view, "hidden");
});

test("manual pause survives visibility changes, leaving the hero, and preference changes", () => {
  const view = browser();
  const toggle = view.el("hero-motion-toggle");
  toggle.fire("click");
  assert.equal(view.body.dataset.motionState, "paused");
  assert.equal(toggle.getAttribute("aria-pressed"), "true");
  assert.equal(toggle.textContent, "Resume motion");
  view.visibility("hidden");
  view.visibility("visible");
  view.intersection(false);
  view.intersection(true);
  view.reduce(true);
  view.reduce(false);
  assert.equal(view.body.dataset.motionState, "paused");
  assert.equal(toggle.disabled, false);
  toggle.fire("click");
  assert.equal(view.body.dataset.motionState, "running");
  assert.equal(toggle.getAttribute("aria-pressed"), "false");
});

test("reduced motion never auto-hides navigation or starts motion", () => {
  const view = browser({ reduced: true });
  assertHeader(view, "shown");
  assert.equal(view.body.dataset.motionState, "paused");
  assert.equal(view.el("hero-motion-toggle").disabled, true);
  assert.equal(view.el("hero-motion-toggle").textContent, "Motion reduced");
  view.el("home-header").fire("pointerleave", { pointerType: "mouse" });
  view.el("header-hide").fire("click");
  view.el("hero-motion-toggle").fire("click");
  view.tick(60000);
  assertHeader(view, "shown");
  assert.equal(view.body.dataset.motionState, "paused");
  assert.equal(view.timers.size, 0);
});

for (const legacyPreference of [false, true]) {
  test(`reduced-motion preference changes apply immediately (${legacyPreference ? "legacy" : "modern"} events)`, () => {
    const view = browser({ legacyPreference });
    view.tick(3000);
    assertHeader(view, "shown");
    view.reduce(true);
    view.tick(10000);
    assertHeader(view, "shown");
    assert.equal(view.body.dataset.motionState, "paused");
    view.reduce(false);
    assert.equal(view.el("hero-motion-toggle").disabled, false);
    assert.equal(view.body.dataset.motionState, "running");
    assertHeader(view, "hidden");
  });
}

for (const [name, options] of [
  ["JavaScript not executed", { run: false }],
  ["inert unavailable", { noInert: true }],
  ["matchMedia unavailable", { noMatchMedia: true }],
  ["preference change APIs unavailable", { noPreferenceEvents: true }],
  ["IntersectionObserver unavailable", { noObserver: true }],
  ["IntersectionObserver fails", { observerThrows: true }],
  ["required button missing", { missing: "header-hide" }],
  ["hero missing", { noHero: true }],
  ["another page", { notHome: true }],
]) {
  test(`${name} leaves ordinary navigation active`, () => {
    const view = browser(options);
    assert.equal(view.body.classList.contains("home-experience-ready"), false);
    assert.notEqual(view.body.dataset.headerState, "hidden");
    assert.notEqual(view.el("home-header").inert, true);
    assert.equal(view.timers.size, 0);
  });
}

test("DOMContentLoaded initializes once and preserves focus already inside navigation", () => {
  const view = browser({ loading: true, focusedHeader: true });
  assert.equal(view.body.classList.contains("home-experience-ready"), false);
  view.document.fire("DOMContentLoaded");
  assertHeader(view, "shown");
  assert.equal(view.timers.size, 0);
  const observerCount = view.observers.length;
  view.document.fire("DOMContentLoaded");
  view.run();
  view.document.fire("DOMContentLoaded");
  assert.equal(view.observers.length, observerCount);
});

test("a deep-link landing or background tab does not schedule an introduction", () => {
  for (const options of [{ scrollY: 200 }, { hidden: true }]) {
    const view = browser(options);
    assert.equal(view.timers.size, 0);
    view.tick(10000);
    assertHeader(view, "hidden");
  }
});

test("an initial observer confirmation does not cancel the timed introduction", () => {
  const view = browser();
  view.intersection(true);
  view.tick(3000);
  assertHeader(view, "shown");
  view.tick(4000);
  assertHeader(view, "hidden");
});

test("an observer failure during resize opens navigation and pauses unseen motion", () => {
  const options = {};
  const view = browser(options);
  options.observerThrows = true;
  view.window.fire("resize");
  assertHeader(view, "shown");
  assert.equal(view.body.dataset.motionState, "paused");
  assert.equal(view.body.dataset.heroVisible, "false");
  assert.equal(view.timers.size, 0);
  view.tick(10000);
  assertHeader(view, "shown");
});

function parallax(view) {
  return view.body.style.getPropertyValue("--hero-parallax-y");
}

function positionHero(view, top, height = 900) {
  view.el("hero").rect = { top, bottom: top + height, height };
}

test("parallax initializes from hero geometry and clamps overscroll at both ends", () => {
  for (const [top, expected] of [[0, 0], [120, 0], [-300, 96], [-1200, 288]]) {
    const view = browser({ run: false });
    positionHero(view, top);
    view.run();
    assert.equal(parallax(view), `${expected}px`, `Initial hero top ${top}`);
    assert.equal(view.frames.size, 0, "Initialization must not start a rendering loop");
  }
});

test("passive scroll events share one frame and use the latest position without looping", () => {
  const view = browser();
  const listeners = view.window.listeners.get("scroll") || [];
  assert.equal(listeners.length, 1);
  assert.equal(listeners[0].passive, true);
  for (const top of [-100, -200, -300]) {
    positionHero(view, top);
    view.window.fire("scroll");
  }
  assert.equal(view.frames.size, 1, "A burst of scrolling schedules one update");
  assert.equal(parallax(view), "0px", "Scroll work waits for the queued frame");
  view.flushFrames();
  assert.equal(parallax(view), "96px");
  assert.equal(view.frames.size, 0, "The frame must not recursively request another frame");
  view.flushFrames();
  assert.equal(parallax(view), "96px");
  assert.equal(view.frames.size, 0);
});

test("scroll parallax follows both directions and remains clamped beyond the hero", () => {
  const view = browser();
  for (const [top, expected] of [[-450, 144], [-1000, 288], [-200, 64], [80, 0]]) {
    positionHero(view, top);
    view.window.fire("scroll");
    view.flushFrames();
    assert.equal(parallax(view), `${expected}px`);
  }
});

test("manual pause cancels queued parallax, resets its offset, and resume uses current geometry", () => {
  const view = browser();
  positionHero(view, -300);
  view.window.fire("scroll");
  view.flushFrames();
  assert.equal(parallax(view), "96px");
  positionHero(view, -400);
  view.window.fire("scroll");
  assert.equal(view.frames.size, 1);
  view.el("hero-motion-toggle").fire("click");
  assert.equal(parallax(view), "0px");
  assert.equal(view.frames.size, 0);
  positionHero(view, -500);
  view.window.fire("scroll");
  view.flushFrames();
  assert.equal(parallax(view), "0px");
  view.el("hero-motion-toggle").fire("click");
  assert.equal(parallax(view), "160px");
  assert.equal(view.frames.size, 0);
});

test("reduced motion resets parallax immediately and reenabling uses current geometry", () => {
  const view = browser();
  positionHero(view, -200);
  view.window.fire("scroll");
  view.flushFrames();
  assert.equal(parallax(view), "64px");
  positionHero(view, -400);
  view.window.fire("scroll");
  view.reduce(true);
  assert.equal(parallax(view), "0px");
  assert.equal(view.frames.size, 0);
  view.window.fire("scroll");
  view.flushFrames();
  assert.equal(parallax(view), "0px");
  view.reduce(false);
  assert.equal(parallax(view), "128px");
});

test("reduced-motion initial landing never adds a parallax offset", () => {
  const view = browser({ run: false, reduced: true });
  positionHero(view, -300);
  view.run();
  assert.equal(parallax(view), "0px");
  assert.equal(view.frames.size, 0);
});

test("a hidden document cancels pending parallax while preserving its last visible offset", () => {
  const view = browser();
  positionHero(view, -300);
  view.window.fire("scroll");
  view.flushFrames();
  assert.equal(parallax(view), "96px");
  positionHero(view, -450);
  view.window.fire("scroll");
  assert.equal(view.frames.size, 1);
  view.visibility("hidden");
  assert.equal(view.frames.size, 0);
  assert.equal(parallax(view), "96px");
  positionHero(view, -600);
  view.window.fire("scroll");
  view.flushFrames();
  assert.equal(parallax(view), "96px");
  view.visibility("visible");
  assert.equal(parallax(view), "192px");
  assert.equal(view.frames.size, 0);
});

test("resize recalculates parallax with the resized hero height", () => {
  const view = browser();
  positionHero(view, -750);
  view.window.fire("scroll");
  view.flushFrames();
  assert.equal(parallax(view), "240px");
  positionHero(view, -750, 600);
  view.window.fire("resize");
  assert.equal(parallax(view), "192px");
  positionHero(view, -200, 600);
  view.window.fire("resize");
  assert.equal(parallax(view), "64px");
  assert.equal(view.frames.size, 0);
});

test("the header observer boundary does not reset parallax while artwork is still visible", () => {
  const view = browser();
  positionHero(view, -810);
  view.window.fire("scroll");
  view.flushFrames();
  const offset = parallax(view);
  assert.notEqual(offset, "0px");
  const hero = view.el("hero");
  view.observers.at(-1).callback([{ target: hero, isIntersecting: false, boundingClientRect: hero.rect }]);
  assert.equal(view.body.dataset.heroVisible, "false");
  assert.equal(view.body.dataset.motionState, "paused");
  assert.equal(parallax(view), offset, "Header visibility must not cause an artwork jump");
  view.intersection(false);
  assert.equal(parallax(view), "288px");
});

for (const [name, options] of [
  ["requestAnimationFrame", { noAnimationFrame: true }],
  ["cancelAnimationFrame", { noCancelAnimationFrame: true }],
]) {
  test(`missing ${name} disables only parallax and retains navigation and zoom`, () => {
    const view = browser(options);
    assert.equal(view.body.classList.contains("home-experience-ready"), true);
    assert.equal(view.body.dataset.motionState, "running");
    assertHeader(view, "hidden");
    positionHero(view, -300);
    view.window.fire("scroll");
    view.flushFrames();
    assert.ok(["", "0px"].includes(parallax(view)));
    assert.equal(view.frames.size, 0);
    view.tick(3000);
    assertHeader(view, "shown");
    view.tick(4000);
    assertHeader(view, "hidden");
    view.el("header-reveal").fire("click");
    assertHeader(view, "shown");
    view.el("hero-motion-toggle").fire("click");
    assert.equal(view.body.dataset.motionState, "paused");
  });
}
