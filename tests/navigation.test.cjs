const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const root = path.resolve(__dirname, "..");
const script = readFileSync(path.join(root, "navigation.js"), "utf8");

function browser({ compact = true, legacy = false, noNavigation = false } = {}) {
  class Events {
    constructor() { this.listeners = new Map(); }
    addEventListener(type, fn) { this.listeners.set(type, [...(this.listeners.get(type) || []), fn]); }
    fire(type, extra = {}) {
      const event = { preventDefault() { this.defaultPrevented = true; }, ...extra };
      for (const fn of this.listeners.get(type) || []) fn(event);
      return event;
    }
  }
  const document = new Events();
  class Element extends Events {
    constructor(name) { super(); this.name = name; this.dataset = {}; this.attributes = {}; this.hidden = false; }
    setAttribute(key, value) { this.attributes[key] = String(value); }
    contains(target) { return target === this || Boolean(target && this.contains(target.parent)); }
    closest(tag) { return this.name === tag ? this : this.parent && this.parent.closest(tag); }
    focus() { assert.equal(this.hidden, false, "Cannot focus a hidden menu control"); document.activeElement = this; }
  }
  const body = new Element("body");
  body.classList = { add: (name) => { body.enhanced = name; } };
  const header = new Element("header");
  const nav = new Element("nav");
  const link = new Element("a");
  const label = new Element("span");
  const outside = new Element("main");
  nav.parent = header; link.parent = nav; label.parent = link;
  header.querySelector = () => noNavigation ? null : nav;
  let toggle;
  header.insertBefore = (el) => { toggle = el; el.parent = header; };
  document.querySelector = () => header;
  document.createElement = (tag) => new Element(tag);
  document.body = body;
  document.activeElement = body;
  const media = new Events();
  media.matches = compact;
  if (legacy) { media.addListener = (fn) => Events.prototype.addEventListener.call(media, "change", fn); media.addEventListener = undefined; }
  vm.runInNewContext(script, { document, window: { matchMedia: () => media } });
  return { document, body, header, nav, link, label, outside, media, get toggle() { return toggle; } };
}

test("all public pages share the progressive navigation enhancement", () => {
  for (const name of ["index", "lily", "current", "incident", "extras", "board"]) {
    const html = readFileSync(path.join(root, `${name}.html`), "utf8");
    assert.match(html, /href="navigation\.css\?v=/);
    assert.match(html, /src="navigation\.js\?v=[^"]+" defer/);
    assert.match(html, /<nav[^>]*aria-label="Primary navigation"/);
  }
});
test("compact menu starts collapsed with a keyboard-operable disclosure", () => {
  const b = browser();
  assert.equal(b.nav.hidden, true);
  assert.equal(b.toggle.type, "button");
  assert.equal(b.toggle.attributes["aria-controls"], b.nav.id);
  assert.equal(b.toggle.attributes["aria-expanded"], "false");
  assert.equal(b.body.enhanced, "site-nav-ready");
  b.toggle.fire("click");
  assert.equal(b.nav.hidden, false);
  assert.equal(b.toggle.attributes["aria-expanded"], "true");
  assert.equal(b.toggle.attributes["aria-label"], "Close menu");
});
test("Escape closes the menu and restores focus", () => {
  const b = browser(); b.toggle.fire("click"); b.link.focus();
  const event = b.document.fire("keydown", { key: "Escape" });
  assert.equal(event.defaultPrevented, true);
  assert.equal(b.nav.hidden, true);
  assert.equal(b.document.activeElement, b.toggle);
});
test("outside clicks and focus departure close the menu", () => {
  const b = browser(); b.toggle.fire("click");
  b.document.fire("click", { target: b.link });
  assert.equal(b.nav.hidden, false);
  b.document.fire("click", { target: b.outside });
  assert.equal(b.nav.hidden, true);
  b.toggle.fire("click"); b.header.fire("focusout", { relatedTarget: b.link });
  assert.equal(b.nav.hidden, false);
  b.header.fire("focusout", { relatedTarget: b.outside });
  assert.equal(b.nav.hidden, true);
});
test("link selection closes the panel without preventing navigation", () => {
  const b = browser(); b.toggle.fire("click"); b.link.focus();
  const event = b.nav.fire("click", { target: b.label });
  assert.equal(b.nav.hidden, true);
  assert.equal(b.document.activeElement, b.toggle);
  assert.equal(event.defaultPrevented, undefined);
});
test("desktop links remain visible and the toggle is absent", () => {
  const b = browser({ compact: false });
  assert.equal(b.nav.hidden, false);
  assert.equal(b.toggle.hidden, true);
  assert.equal(b.toggle.attributes["aria-expanded"], "false");
  b.document.fire("keydown", { key: "Escape" });
  assert.equal(b.nav.hidden, false);
});
test("breakpoint changes expose the control before restoring its focus", () => {
  const b = browser({ compact: false }); b.link.focus();
  b.media.matches = true; b.media.fire("change");
  assert.equal(b.toggle.hidden, false);
  assert.equal(b.nav.hidden, true);
  assert.equal(b.document.activeElement, b.toggle);
  b.toggle.fire("click"); b.media.matches = false; b.media.fire("change");
  assert.equal(b.nav.hidden, false);
  assert.equal(b.toggle.hidden, true);
});
test("legacy media query listeners work", () => {
  const b = browser({ legacy: true });
  b.media.matches = false; b.media.fire("change");
  assert.equal(b.nav.hidden, false);
});
test("missing navigation leaves the page alone", () => {
  const b = browser({ noNavigation: true });
  assert.equal(b.toggle, undefined);
  assert.equal(b.body.enhanced, undefined);
});
