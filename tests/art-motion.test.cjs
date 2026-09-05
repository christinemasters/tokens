const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const script = () => readFileSync(path.join(root, "art-motion.js"), "utf8");

class Events {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, fn, options) {
    const listeners = this.listeners.get(type) || [];
    listeners.push({ fn, once: Boolean(options && options.once), passive: Boolean(options && options.passive) });
    this.listeners.set(type, listeners);
  }
  fire(type, details = {}) {
    for (const listener of [...(this.listeners.get(type) || [])]) {
      if (listener.once) this.listeners.set(type, this.listeners.get(type).filter((item) => item !== listener));
      listener.fn(details);
    }
  }
}

function browser(options = {}) {
  class Element extends Events {
    constructor() {
      super();
      this.dataset = {};
      this.attributes = {};
      this.disabled = false;
      this.textContent = "";
      const classes = new Set();
      this.classList = { contains: (name) => classes.has(name), add: (name) => classes.add(name) };
      const properties = new Map();
      this.style = {
        setProperty: (name, value) => properties.set(name, String(value)),
        getPropertyValue: (name) => properties.get(name) || "",
      };
      this.rect = { top: 100, bottom: 700, height: 600 };
    }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    getAttribute(name) { return this.attributes[name] ?? null; }
    getBoundingClientRect() { return this.rect; }
  }

  const body = new Element();
  const portraits = options.noArtwork ? [] : [new Element(), new Element()];
  if (portraits[1]) portraits[1].rect = { top: 1000, bottom: 1600, height: 600 };
  const covers = options.noArtwork || options.noCover ? [] : [new Element()];
  const controls = options.noControls ? [] : [new Element(), new Element()];
  const document = new Events();
  document.body = options.noBody ? null : body;
  document.readyState = options.loading ? "loading" : "complete";
  document.visibilityState = options.hidden ? "hidden" : "visible";
  document.querySelectorAll = (selector) => ({
    "[data-portrait-motion]": portraits,
    "[data-cover-motion]": covers,
    "[data-art-motion-toggle]": controls,
  })[selector] || [];

  const frames = new Map();
  let nextFrame = 0;
  const window = new Events();
  window.innerHeight = 900;
  if (!options.noFrames) {
    window.requestAnimationFrame = (fn) => { const id = ++nextFrame; frames.set(id, fn); return id; };
    if (!options.noCancelFrame) window.cancelAnimationFrame = (id) => frames.delete(id);
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
  if (!options.noMatchMedia) window.matchMedia = () => {
    if (options.preferenceThrows) throw new Error("Preference unavailable");
    return preference;
  };
  const observers = [];
  if (!options.noObserver) window.IntersectionObserver = class {
    constructor(callback, settings) {
      if (options.observerThrows) throw new Error("Observer unavailable");
      this.callback = callback;
      this.settings = settings;
      this.targets = [];
      observers.push(this);
    }
    observe(target) { this.targets.push(target); }
    disconnect() { this.disconnected = true; }
  };

  const run = () => vm.runInNewContext(script(), { window, document }, { filename: "art-motion.js" });
  if (options.run !== false) run();
  return {
    body, portraits, covers, controls, document, window, preference, observers, frames, run,
    flushFrames() {
      const pending = [...frames.values()];
      frames.clear();
      for (const fn of pending) fn(0);
    },
    intersect(index, visible) {
      const target = portraits[index];
      target.rect = visible ? { top: 100, bottom: 700, height: 600 } : { top: -700, bottom: -100, height: 600 };
      observers.at(-1).callback([{ target, isIntersecting: visible, boundingClientRect: target.rect }]);
    },
    reduce(value) { preference.matches = value; preference.fire("change", { matches: value }); },
    visibility(value) { document.visibilityState = value; document.fire("visibilitychange"); },
    offset() { return Number(covers[0].style.getPropertyValue("--cover-parallax-y").replace("px", "")); },
  };
}

function assertControls(view, { paused = false, reduced = false } = {}) {
  for (const control of view.controls) {
    assert.equal(control.disabled, reduced);
    assert.equal(control.getAttribute("aria-pressed"), String(paused || reduced));
    assert.equal(control.textContent, reduced ? "Motion reduced" : paused ? "Resume motion" : "Pause motion");
    assert.equal(control.getAttribute("aria-label"), reduced ? "Motion reduced" : paused ? "Resume artwork motion" : "Pause artwork motion");
  }
}

test("three artwork pages load scoped enhancement assets without hiding static content", () => {
  let portraits = 0;
  for (const page of ["index.html", "lily.html", "current.html"]) {
    const html = readFileSync(path.join(root, page), "utf8");
    assert.match(html, /<link\b[^>]*href="art-motion\.css\?[^\"]+"/);
    assert.match(html, /<script\b[^>]*src="art-motion\.js\?[^\"]+"[^>]*\bdefer\b/);
    assert.doesNotMatch(html.match(/<body\b[^>]*>/)?.[0] || "", /art-motion-ready/);
    const wrappers = html.match(/<[^/!][^>]*\bdata-portrait-motion(?:\s|=|>)[^>]*>/g) || [];
    portraits += wrappers.length;
    assert.equal(wrappers.length, page === "index.html" ? 2 : 1, page);
    assert.match(html, /<button\b[^>]*\bdata-art-motion-toggle(?:\s|=|>)[^>]*>/);
    for (const anchor of html.matchAll(/<a\b[^>]*class="profile-card"[^>]*>([\s\S]*?)<\/a>/g)) {
      assert.match(anchor[1], /\bdata-portrait-motion\b/);
      assert.doesNotMatch(anchor[1], /<button\b/, "Motion controls cannot nest inside profile links");
    }
    if (page !== "index.html") {
      assert.match(html, /<p\b[^>]*class="profile-art-label"[^>]*>\s*<span>[^<]+<\/span>\s*<span>Authorization: none<\/span>\s*<\/p>/);
    }
  }
  assert.equal(portraits, 4);
  const home = readFileSync(path.join(root, "index.html"), "utf8");
  assert.match(home, /<figure\b[^>]*\bdata-cover-motion(?=\s|=|>)[^>]*>[\s\S]*?<div\b[^>]*class="cover-float"[^>]*>[\s\S]*?<img\b[^>]*class="book-cover"/);
});

test("CSS confines zoom to portrait images and removes motion under reduced-motion preferences", () => {
  const css = readFileSync(path.join(root, "art-motion.css"), "utf8");
  assert.doesNotMatch(css, /\.hero(?:-|\b)/, "Existing hero artwork must remain unchanged");
  assert.match(css, /\.art-motion-ready\s+\[data-portrait-motion\]\s*>\s*img\s*\{[^}]*animation:\s*portrait-breathe\s+20s\s+linear\s+infinite\s+alternate;[^}]*animation-play-state:\s*paused;/);
  assert.match(css, /\[data-art-motion-state="running"\]\s+\[data-portrait-motion\]\[data-motion-visible="true"\]\s*>\s*img\s*\{[^}]*animation-play-state:\s*running;/);
  assert.match(css, /@keyframes portrait-breathe\s*\{\s*from\s*\{\s*transform:\s*scale\(1\);\s*\}\s*to\s*\{\s*transform:\s*scale\(1\.1\);/);
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*\.cover-float\s*\{\s*transform:\s*none;/);
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*animation:\s*none;[\s\S]*transform:\s*none;/);
});

test("only visible portrait wrappers animate and observers do not track moving cover children", () => {
  const view = browser();
  assert.equal(view.body.classList.contains("art-motion-ready"), true);
  assert.equal(view.body.dataset.artMotionState, "running");
  assert.equal(view.portraits[0].dataset.motionVisible, "true");
  assert.equal(view.portraits[1].dataset.motionVisible, "false");
  assert.deepEqual(view.observers.flatMap((observer) => observer.targets), view.portraits);
  assertControls(view);
  view.intersect(0, false);
  view.intersect(1, true);
  assert.equal(view.portraits[0].dataset.motionVisible, "false");
  assert.equal(view.portraits[1].dataset.motionVisible, "true");
});

test("cover displacement follows scroll geometry, stays bounded, and does not self-schedule", () => {
  const view = browser();
  view.flushFrames();
  assert.equal(view.offset(), 9);
  for (const [rect, expected] of [
    [{ top: 1000, bottom: 1600, height: 600 }, -40],
    [{ top: -700, bottom: -100, height: 600 }, 40],
    [{ top: 150, bottom: 750, height: 600 }, 0],
    [{ top: 50, bottom: 650, height: 600 }, 18],
  ]) {
    view.covers[0].rect = rect;
    view.window.fire("scroll");
    view.flushFrames();
    assert.equal(view.offset(), expected);
    assert.equal(view.frames.size, 0, "A frame must not create an idle render loop");
  }
});

test("scroll listeners are passive and bursts coalesce into one animation frame", () => {
  const view = browser();
  view.flushFrames();
  assert.ok(view.window.listeners.get("scroll").every((listener) => listener.passive));
  for (let index = 0; index < 20; index += 1) view.window.fire("scroll");
  assert.equal(view.frames.size, 1);
  view.flushFrames();
  assert.equal(view.frames.size, 0);
  view.window.innerHeight = 1000;
  view.window.fire("resize");
  view.flushFrames();
  assert.equal(view.offset(), 18);
});

test("either control pauses every artwork and cancels queued parallax", () => {
  const view = browser();
  view.window.fire("scroll");
  view.controls[1].fire("click");
  assert.equal(view.body.dataset.artMotionState, "paused");
  assertControls(view, { paused: true });
  assert.equal(view.offset(), 0);
  assert.equal(view.frames.size, 0);
  view.window.fire("scroll");
  assert.equal(view.frames.size, 0);
  view.controls[0].fire("click");
  view.flushFrames();
  assert.equal(view.body.dataset.artMotionState, "running");
  assertControls(view);
  assert.equal(view.offset(), 9);
});

test("hidden documents pause motion, retain the cover offset, and do not change manual controls", () => {
  const view = browser();
  view.flushFrames();
  assert.equal(view.offset(), 9);
  view.window.fire("scroll");
  view.visibility("hidden");
  assert.equal(view.body.dataset.artMotionState, "paused");
  assertControls(view);
  assert.equal(view.frames.size, 0);
  view.covers[0].rect = { top: 50, bottom: 650, height: 600 };
  view.window.fire("scroll");
  assert.equal(view.frames.size, 0);
  assert.equal(view.offset(), 9);
  view.visibility("visible");
  view.flushFrames();
  assert.equal(view.body.dataset.artMotionState, "running");
  assert.equal(view.offset(), 18);
});

test("manual pause survives visibility and reduced-motion preference changes", () => {
  const view = browser();
  view.controls[0].fire("click");
  view.visibility("hidden");
  view.visibility("visible");
  assert.equal(view.body.dataset.artMotionState, "paused");
  assertControls(view, { paused: true });
  view.reduce(true);
  assertControls(view, { reduced: true });
  assert.equal(view.offset(), 0);
  view.reduce(false);
  assertControls(view, { paused: true });
  assert.equal(view.body.dataset.artMotionState, "paused");
});

test("reduced motion starts still and observes later preference changes", () => {
  const view = browser({ reduced: true });
  assert.equal(view.body.dataset.artMotionState, "paused");
  assertControls(view, { reduced: true });
  assert.equal(view.offset(), 0);
  view.window.fire("scroll");
  assert.equal(view.frames.size, 0);
  view.reduce(false);
  view.flushFrames();
  assert.equal(view.body.dataset.artMotionState, "running");
  assertControls(view);
  assert.equal(view.offset(), 9);
  view.reduce(true);
  assert.equal(view.body.dataset.artMotionState, "paused");
  assertControls(view, { reduced: true });
  assert.equal(view.offset(), 0);
});

test("legacy preference listeners retain reduced-motion behavior", () => {
  const view = browser({ legacyPreference: true });
  view.reduce(true);
  assert.equal(view.body.dataset.artMotionState, "paused");
  assertControls(view, { reduced: true });
});

for (const option of ["noBody", "noArtwork", "noControls", "noMatchMedia", "preferenceThrows", "noPreferenceEvents", "noObserver", "observerThrows"]) {
  test(`${option} leaves a usable unenhanced page`, () => {
    const view = browser({ [option]: true });
    assert.equal(view.body.classList.contains("art-motion-ready"), false);
    assert.equal(view.frames.size, 0);
  });
}

for (const option of ["noFrames", "noCancelFrame"]) {
  test(`${option} leaves cover still while portraits and their controls work`, () => {
    const view = browser({ [option]: true });
    assert.equal(view.body.classList.contains("art-motion-ready"), true);
    assert.equal(view.body.dataset.artMotionState, "running");
    view.window.fire("scroll");
    assert.equal(view.frames.size, 0);
    assert.equal(view.offset(), 0);
    view.controls[0].fire("click");
    assertControls(view, { paused: true });
  });
}

test("profile-only pages enhance portraits without requiring a cover", () => {
  const view = browser({ noCover: true });
  assert.equal(view.body.classList.contains("art-motion-ready"), true);
  assert.equal(view.body.dataset.artMotionState, "running");
  view.window.fire("scroll");
  view.flushFrames();
  assert.equal(view.frames.size, 0);
  view.controls[0].fire("click");
  assertControls(view, { paused: true });
});

test("DOMContentLoaded initializes once and repeated execution does not duplicate listeners", () => {
  const view = browser({ loading: true });
  assert.equal(view.body.classList.contains("art-motion-ready"), false);
  view.document.fire("DOMContentLoaded");
  assert.equal(view.body.classList.contains("art-motion-ready"), true);
  view.document.readyState = "complete";
  view.run();
  assert.equal(view.controls[0].listeners.get("click").length, 1);
});
