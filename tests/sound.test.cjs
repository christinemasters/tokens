const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { createHash } = require("node:crypto");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const root = path.resolve(__dirname, "..");
const script = readFileSync(path.join(root, "sound.js"), "utf8");
const html = readFileSync(path.join(root, "index.html"), "utf8");

class Events {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, fn) { this.listeners.set(type, [...(this.listeners.get(type) || []), fn]); }
  fire(type) { for (const fn of this.listeners.get(type) || []) fn({ type }); }
}

function setup(options = {}) {
  const document = new Events();
  document.readyState = options.loading ? "loading" : "complete";
  document.visibilityState = "visible";
  const window = new Events();
  const timers = new Map();
  let timerId = 0;
  window.setTimeout = fn => { const id = ++timerId; timers.set(id, fn); return id; };
  window.clearTimeout = id => timers.delete(id);
  const elements = Object.fromEntries(["sound-control", "sound-toggle", "sound-label", "sound-status", "background-music"].map(id => {
    const element = new Events();
    element.dataset = {};
    element.attributes = {};
    element.hidden = id === "sound-control";
    element.textContent = "";
    element.setAttribute = (key, value) => { element.attributes[key] = String(value); };
    element.getAttribute = key => element.attributes[key] ?? null;
    return [id, element];
  }));
  const music = elements["background-music"];
  music.dataset.src = "the-gap-between-seconds.mp3";
  music.paused = true;
  music.currentTime = 0;
  music.playCalls = 0;
  music.loadCalls = 0;
  Object.defineProperty(music, "src", { get: () => music.getAttribute("src"), set: v => music.setAttribute("src", v) });
  music.play = () => {
    music.playCalls++;
    if (options.throws) throw new Error("Playback unavailable");
    if (options.reject) return Promise.reject(new Error("NotAllowedError"));
    if (options.deferred) return options.deferred;
    music.paused = false;
    return options.noPromise ? undefined : Promise.resolve();
  };
  music.pause = () => { const changed = !music.paused; music.paused = true; if (changed) music.fire("pause"); };
  music.load = () => { music.loadCalls++; music.error = null; };
  if (options.noMedia) music.play = undefined;
  if (options.noSource) delete music.dataset.src;
  if (options.noVolume) Object.defineProperty(music, "volume", { set() { throw new Error("Hardware volume only"); } });
  document.getElementById = id => options.missing === id ? null : elements[id];
  const run = () => vm.runInNewContext(script, { document, window });
  run();
  return {
    document, window, elements, music, timers, run,
    button: elements["sound-toggle"],
    control: elements["sound-control"],
    status: elements["sound-status"],
    click() { elements["sound-toggle"].fire("click"); },
    visibility(value) { document.visibilityState = value; document.fire("visibilitychange"); },
    timeout() { for (const [id, fn] of [...timers]) { timers.delete(id); fn(); } },
  };
}
const settled = () => new Promise(resolve => setImmediate(resolve));

test("music is opt-in and the fixed control is outside the hiding header", () => {
  const audio = html.match(/<audio\b[^>]*>/)?.[0];
  assert.match(audio, /preload="none"/);
  assert.match(audio, /\sloop\b/);
  assert.match(audio, /data-src="the-gap-between-seconds\.mp3"/);
  assert.doesNotMatch(audio, /\s(?:src|autoplay)=?/);
  assert.ok(html.indexOf('id="sound-control"') < html.indexOf('id="home-header"'));
  assert.match(html, /aria-pressed="false" aria-label="Turn background music on"/);
  assert.doesNotMatch(script, /localStorage|sessionStorage|fetch\(|sendBeacon|\.currentTime\s*=/);
});

test("the mobile video remains exactly the previously approved file", () => {
  const digest = createHash("sha256").update(readFileSync(path.join(root, "hero-video-mobile.mp4"))).digest("hex");
  assert.equal(digest, "a50d1f9debfdb432b2e1d90817b6fb9d5ddfad53db2070c2f105a8851c1f0ca7");
  assert.match(html, /data-mobile-src="hero-video-mobile\.mp4"/);
  assert.match(html, /data-src="hero-video-final\.mp4"/);
});

test("the supplied soundtrack is preserved without audio edits", () => {
  const digest = createHash("sha256").update(readFileSync(path.join(root, "the-gap-between-seconds.mp3"))).digest("hex");
  assert.equal(digest, "89e6c4df2ed99cee37079258ea95da6f4ac286654769581d00caa4a6bd528baa");
});

test("a fresh page shows off, never loads audio and never calls play", () => {
  const view = setup();
  assert.equal(view.control.hidden, false);
  assert.equal(view.control.dataset.sound, "off");
  assert.equal(view.music.src, null);
  assert.equal(view.music.playCalls, 0);
  assert.equal(view.music.volume, 0.35);
  assert.equal(view.button.getAttribute("aria-pressed"), "false");
  view.visibility("hidden"); view.visibility("visible");
  assert.equal(view.music.playCalls, 0);
});

test("click enables audio, a second click pauses, and resuming preserves position", async () => {
  const view = setup();
  view.click();
  assert.equal(view.music.src, "the-gap-between-seconds.mp3");
  assert.equal(view.music.playCalls, 1);
  await settled();
  assert.equal(view.control.dataset.sound, "on");
  assert.equal(view.button.getAttribute("aria-label"), "Turn background music off");
  assert.equal(view.button.getAttribute("aria-pressed"), "true");
  view.music.currentTime = 48;
  view.click();
  assert.equal(view.music.paused, true);
  assert.equal(view.control.dataset.sound, "off");
  view.click(); await settled();
  assert.equal(view.music.currentTime, 48);
  assert.equal(view.music.paused, false);
});

test("hidden tabs pause and only an existing opt-in resumes", async () => {
  const view = setup();
  view.click(); await settled();
  view.visibility("hidden");
  assert.equal(view.music.paused, true);
  assert.equal(view.control.dataset.sound, "paused");
  view.visibility("visible"); await settled();
  assert.equal(view.music.paused, false);
  view.click();
  view.visibility("hidden"); view.visibility("visible");
  assert.equal(view.music.paused, true);
  assert.equal(view.music.playCalls, 2);
});

test("leaving the page clears consent even with a back-forward cache restore", async () => {
  const view = setup();
  view.click(); await settled();
  view.window.fire("pagehide");
  view.window.fire("pageshow");
  view.visibility("visible");
  assert.equal(view.music.paused, true);
  assert.equal(view.control.dataset.sound, "off");
  assert.equal(view.music.playCalls, 1);
});

test("a late playing event cannot override an off click", async () => {
  let finish;
  const view = setup({ deferred: new Promise(resolve => { finish = resolve; }) });
  view.click(); view.click();
  view.music.paused = false;
  view.music.fire("playing");
  finish(); await settled();
  assert.equal(view.music.paused, true);
  assert.equal(view.control.dataset.sound, "off");
  assert.equal(view.timers.size, 0);
});

test("an older rejected play promise cannot disable a newer opt-in", async () => {
  let reject;
  const options = { deferred: new Promise((_, fail) => { reject = fail; }) };
  const view = setup(options);
  view.click(); view.click();
  options.deferred = null;
  view.click(); reject(new Error("Aborted old request")); await settled();
  assert.equal(view.music.paused, false);
  assert.equal(view.control.dataset.sound, "on");
});

for (const kind of ["reject", "throws"]) test(`a ${kind} playback failure is visible and retryable`, async () => {
  const options = { [kind]: true };
  const view = setup(options);
  view.click(); await settled();
  assert.equal(view.control.dataset.sound, "error");
  assert.equal(view.music.paused, true);
  assert.equal(view.button.getAttribute("aria-pressed"), "false");
  assert.match(view.status.textContent, /could not start/);
  options[kind] = false;
  view.click(); await settled();
  assert.equal(view.control.dataset.sound, "on");
});

test("a stalled start times out without playing unexpectedly later", async () => {
  let finish;
  const view = setup({ deferred: new Promise(resolve => { finish = resolve; }) });
  view.click(); view.timeout();
  assert.equal(view.control.dataset.sound, "error");
  view.music.paused = false; view.music.fire("playing");
  finish(); await settled();
  assert.equal(view.music.paused, true);
  assert.equal(view.control.dataset.sound, "error");
});

test("a media error stops sound and retry reloads the failed resource", async () => {
  const view = setup();
  view.click(); await settled();
  view.music.error = { code: 2 }; view.music.fire("error");
  assert.equal(view.control.dataset.sound, "error");
  view.click(); await settled();
  assert.equal(view.music.loadCalls, 1);
  assert.equal(view.control.dataset.sound, "on");
});

test("a native media pause is respected, not automatically restarted", async () => {
  const view = setup();
  view.click(); await settled();
  view.music.pause();
  assert.equal(view.control.dataset.sound, "off");
  view.visibility("hidden"); view.visibility("visible");
  assert.equal(view.music.playCalls, 1);
});

test("older media APIs can signal success with playing instead of a promise", () => {
  const view = setup({ noPromise: true });
  view.click(); view.music.fire("playing");
  assert.equal(view.control.dataset.sound, "on");
  assert.equal(view.timers.size, 0);
});

test("hardware-only volume does not prevent an explicit play", async () => {
  const view = setup({ noVolume: true });
  view.click(); await settled();
  assert.equal(view.control.dataset.sound, "on");
});

test("initialization waits for the DOM and runs once", () => {
  const view = setup({ loading: true });
  assert.equal(view.control.hidden, true);
  view.document.fire("DOMContentLoaded");
  view.document.readyState = "complete";
  view.run(); view.click();
  assert.equal(view.music.playCalls, 1);
});

for (const options of [{ missing: "sound-status" }, { noMedia: true }, { noSource: true }]) test(`incomplete enhancement stays safely hidden: ${JSON.stringify(options)}`, () => {
  const view = setup(options);
  assert.equal(view.control.hidden, true);
  assert.equal(view.music.playCalls, 0);
});

test("the control has a touch-sized target, focus ring, safe-area offsets and no animation", () => {
  const css = readFileSync(path.join(root, "sound.css"), "utf8");
  assert.match(css, /position: fixed/);
  assert.match(css, /min-height: 2\.75rem/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /safe-area-inset-bottom/);
  assert.doesNotMatch(css, /animation\s*:/);
});
