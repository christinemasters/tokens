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
    querySelector(selector) { return selector === "video[data-src]" ? this.video || null : null; }
  }

  const body = new Element();
  const portraits = options.noArtwork ? [] : [new Element(), new Element()];
  if (portraits[1]) portraits[1].rect = { top: 1000, bottom: 1600, height: 600 };
  const covers = options.noArtwork || options.noCover ? [] : [new Element()];
  const controls = options.noControls ? [] : [new Element(), new Element()];
  const videos = options.video ? portraits.map((portrait, index) => {
    const video = new Element();
    video.dataset.src = options.noVideoSource ? "" : `portrait-${index}.mp4`;
    video.paused = true;
    video.currentTime = 0;
    video.playCalls = 0;
    video.pauseCalls = 0;
    video.pendingPlays = [];
    Object.defineProperty(video, "src", {
      get() { return video.getAttribute("src"); },
      set(value) { video.setAttribute("src", value); },
    });
    video.play = function () {
      video.playCalls++;
      if (options.throwPlay) throw new Error("Playback unavailable");
      if (options.rejectPlay) return Promise.reject(new Error("Playback blocked"));
      video.paused = false;
      if (options.deferPlay) return new Promise((resolve, reject) => video.pendingPlays.push({ resolve, reject }));
      return options.noPlayPromise ? undefined : Promise.resolve();
    };
    video.pause = function () { video.pauseCalls++; video.paused = true; };
    if (options.noVideoAPI) video.play = undefined;
    portrait.video = video;
    return video;
  }) : [];
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
  const timers = new Map();
  let nextTimer = 0;
  window.setTimeout = (fn, delay) => { const id = ++nextTimer; timers.set(id, { fn, delay }); return id; };
  window.clearTimeout = id => timers.delete(id);
  const connection = new Events();
  connection.saveData = Boolean(options.saveData);
  window.navigator = { connection };
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
    body, portraits, covers, controls, document, window, preference, observers, frames, run, videos, timers,
    playing(index = 0) { videos[index].paused = false; videos[index].fire("playing"); },
    saveData(value) { connection.saveData = value; connection.fire("change"); },
    expireVideoTimers() { const pending = [...timers.values()]; timers.clear(); pending.forEach(timer => timer.fn()); },
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

const flushVideo = () => new Promise(resolve => setImmediate(resolve));

test("the cover has no separate button while portrait controls and reduced-motion support remain", () => {
  const html = readFileSync(path.join(root, "index.html"), "utf8");
  const cover = html.match(/<figure\b[^>]*data-cover-motion[\s\S]*?<\/figure>/)?.[0];
  assert.ok(cover);
  assert.doesNotMatch(cover, /<button\b|cover-motion-caption|cover-motion-help/);
  assert.match(html, /class="art-motion-toggle portraits-motion-toggle"/);
  const view = browser();
  assert.equal(view.offset(), 9);
  view.covers[0].rect = { top: 1000, bottom: 1600, height: 600 };
  view.window.fire("scroll");
  view.flushFrames();
  assert.equal(view.offset(), -40);
  view.reduce(true);
  assert.equal(view.offset(), 0);
});

test("only the two character pages add deferred silent portrait videos, retaining their stills", () => {
  for (const name of ["lily", "current"]) {
    const html = readFileSync(path.join(root, name + ".html"), "utf8");
    const video = html.match(/<video\b[^>]*>/)?.[0];
    assert.ok(video);
    assert.ok(video.includes(`data-src="${name}-portrait-video.mp4"`));
    for (const attr of ['preload="none"', 'muted', 'loop', 'playsinline', 'aria-hidden="true"', 'tabindex="-1"']) assert.ok(video.includes(attr));
    assert.doesNotMatch(video, /\s(?:src|autoplay|controls)=?/);
    assert.ok(html.includes(`src="${name}-profile.jpg?v=20260904"`));
    assert.match(html, /fictional character inspired by a documented agent identifier/);
  }
  assert.doesNotMatch(readFileSync(path.join(root, "index.html"), "utf8"), /class="portrait-video"/);
});

test("a visible portrait loads silently but retains the still until a playing frame", async () => {
  const view = browser({ video: true });
  await flushVideo();
  assert.equal(view.videos[0].src, "portrait-0.mp4");
  assert.equal(view.videos[0].muted, true);
  assert.equal(view.videos[0].playCalls, 1);
  assert.notEqual(view.portraits[0].dataset.portraitVideo, "ready");
  assert.equal(view.videos[1].src, null);
  assert.equal(view.videos[1].playCalls, 0);
  view.playing();
  assert.equal(view.portraits[0].dataset.portraitVideo, "ready");
  assert.equal(view.timers.size, 0);
});

for (const mode of ["reduced", "saveData", "hidden"]) test(`${mode} prevents any initial portrait video download`, () => {
  const view = browser({ video: true, [mode]: true });
  for (const video of view.videos) {
    assert.equal(video.src, null);
    assert.equal(video.playCalls, 0);
  }
});

test("scrolling away pauses a portrait and entering the next one loads only that clip", async () => {
  const view = browser({ video: true });
  view.playing();
  view.intersect(0, false);
  assert.equal(view.videos[0].paused, true);
  view.intersect(1, true);
  assert.equal(view.videos[1].playCalls, 1);
  assert.equal(view.videos[1].src, "portrait-1.mp4");
  await flushVideo();
});

test("the existing pause control freezes video and resumes at the same position", async () => {
  const view = browser({ video: true });
  view.playing();
  view.videos[0].currentTime = 4.5;
  view.controls[0].fire("click");
  assert.equal(view.videos[0].paused, true);
  assert.equal(view.portraits[0].dataset.portraitVideo, "ready");
  view.visibility("hidden");
  view.visibility("visible");
  assert.equal(view.videos[0].playCalls, 1);
  view.controls[0].fire("click");
  assert.equal(view.videos[0].playCalls, 2);
  assert.equal(view.videos[0].currentTime, 4.5);
  await flushVideo();
});

test("hidden tabs and pagehide pause video; returning respects manual pause", async () => {
  const view = browser({ video: true });
  view.playing();
  view.visibility("hidden");
  assert.equal(view.videos[0].paused, true);
  view.visibility("visible");
  assert.equal(view.videos[0].playCalls, 2);
  view.playing();
  view.window.fire("pagehide");
  assert.equal(view.videos[0].paused, true);
  view.window.fire("pageshow");
  assert.equal(view.videos[0].playCalls, 3);
  view.controls[0].fire("click");
  view.window.fire("pagehide");
  view.window.fire("pageshow");
  assert.equal(view.videos[0].paused, true);
  assert.equal(view.videos[0].playCalls, 3);
  await flushVideo();
});

test("motion and data-saving changes show the still, and a later playing frame restores video", async () => {
  const view = browser({ video: true });
  view.playing();
  view.reduce(true);
  assert.equal(view.videos[0].paused, true);
  assert.equal(view.portraits[0].dataset.portraitVideo, "fallback");
  view.reduce(false);
  view.playing();
  assert.equal(view.portraits[0].dataset.portraitVideo, "ready");
  view.saveData(true);
  assert.equal(view.videos[0].paused, true);
  assert.equal(view.portraits[0].dataset.portraitVideo, "fallback");
  view.saveData(false);
  view.playing();
  assert.equal(view.portraits[0].dataset.portraitVideo, "ready");
  await flushVideo();
});

for (const kind of ["throwPlay", "rejectPlay"]) test(`${kind} safely falls back without an automatic retry loop`, async () => {
  const view = browser({ video: true, [kind]: true });
  await flushVideo();
  assert.equal(view.portraits[0].dataset.portraitVideo, "fallback");
  assert.equal(view.videos[0].paused, true);
  view.window.fire("resize");
  assert.equal(view.videos[0].playCalls, 1);
});

test("media error and stalled startup return to the still without late unexpected playback", () => {
  const failed = browser({ video: true });
  failed.playing();
  failed.videos[0].fire("error");
  assert.equal(failed.portraits[0].dataset.portraitVideo, "fallback");
  assert.equal(failed.videos[0].paused, true);
  const stalled = browser({ video: true, deferPlay: true });
  stalled.expireVideoTimers();
  assert.equal(stalled.portraits[0].dataset.portraitVideo, "fallback");
  stalled.playing();
  assert.equal(stalled.videos[0].paused, true);
});

test("an aborted old request cannot replace a resumed portrait with its fallback", async () => {
  const view = browser({ video: true, deferPlay: true });
  view.controls[0].fire("click");
  view.controls[0].fire("click");
  view.playing();
  view.videos[0].pendingPlays[0].reject(new Error("Old request aborted"));
  view.videos[0].pendingPlays[1].resolve();
  await flushVideo();
  assert.equal(view.portraits[0].dataset.portraitVideo, "ready");
  assert.equal(view.videos[0].paused, false);
});

test("a late playing event cannot defeat manual pause", () => {
  const view = browser({ video: true, deferPlay: true });
  view.controls[0].fire("click");
  view.playing();
  assert.equal(view.videos[0].paused, true);
  assert.notEqual(view.portraits[0].dataset.portraitVideo, "ready");
});

for (const option of ["noVideoAPI", "noVideoSource"]) test(`${option} leaves the original artwork and its controller usable`, () => {
  const view = browser({ video: true, [option]: true });
  assert.equal(view.body.classList.contains("art-motion-ready"), true);
  assert.equal(view.videos[0].src, null);
  view.controls[0].fire("click");
  assertControls(view, { paused: true });
});

test("older media APIs can reveal a portrait through the playing event alone", () => {
  const view = browser({ video: true, noPlayPromise: true });
  view.playing();
  assert.equal(view.portraits[0].dataset.portraitVideo, "ready");
  assert.equal(view.timers.size, 0);
});
