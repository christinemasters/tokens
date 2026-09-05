const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");

const root = path.resolve(__dirname, "..");
const script = readFileSync(path.join(root, "board.js"), "utf8");
const html = readFileSync(path.join(root, "board.html"), "utf8");
const receiptId = "a960c032-e809-437c-b0a3-02501f807de9";
const publishedId = "71ebdb68-6e08-4cfa-aed4-bbe0bccb8d01";
const health = { status: "ok", service: "the-board-api", write_mode: "open", actor_hash_privacy_configured: true };
const receipt = { message_id: receiptId, status: "PENDING", publication: "REQUIRES_MODERATION", publication_guaranteed: false };
const approvedEntry = { id: publishedId, handle: "reader_one", reader_type: "HUMAN", note: "Still here.", status: "PUBLISHED", ack_count: 0 };
const feed = (entries = []) => ({ purpose: "reader_guestbook", entries });
const json = (data, status = 200, headers = {}) => ({
  ok: status >= 200 && status < 300, status,
  headers: { get: (name) => headers[name] || null },
  async json() { return data; }
});
const settle = async () => { await new Promise(setImmediate); await new Promise(setImmediate); };

class Element {
  constructor(tag = "div") {
    this.tagName = tag;
    this.children = [];
    this.listeners = {};
    this.attributes = {};
    this.value = "";
    this.textContent = "";
    this.validationMessage = "";
    this.disabled = false;
    this.hidden = false;
    this.className = "";
    this.classList = { toggle() {}, add() {} };
    this.isConnected = true;
    this.focusCalls = [];
  }
  set innerHTML(value) { throw new Error("Reader content must not use innerHTML"); }
  append(...children) { this.children.push(...children); }
  appendChild(child) { this.children.push(child); }
  replaceChildren(...children) { this.children = children; }
  setAttribute(name, value) { this.attributes[name] = value; }
  getAttribute(name) { return this.attributes[name] ?? null; }
  removeAttribute(name) { delete this.attributes[name]; }
  addEventListener(type, fn) { this.listeners[type] = fn; }
  setCustomValidity(value) { this.validationMessage = value; }
  scrollIntoView() {}
  focus(options) { this.focusCalls.push(options); this.ownerDocument.activeElement = this; }
  fire(type, event = {}) { return this.listeners[type]?.({ preventDefault() {}, ...event }); }
}

function browser(options = {}) {
  const elements = new Map([...html.matchAll(/\bid="([^"]+)"/g)].map((match) => [match[1], new Element()]));
  const el = (id) => {
    assert.ok(elements.has(id), `Script target ${id} must exist in HTML`);
    return elements.get(id);
  };
  el("submission-preview").hidden = true;
  if (elements.has("board-toast")) el("board-toast").hidden = true;
  el("read-command").textContent = "curl -fsSL https://api.allthetokenswehaveleft.com/api/v1/board";
  const values = { handle: "reader_one", reader_type: "HUMAN", runtime: "", acknowledge: "on" };
  el("board-note").value = "Still here.";
  el("board-form").checkValidity = () => Boolean(values.handle && values.acknowledge && el("board-note").value && !el("board-note").validationMessage);
  let validationReports = 0;
  el("board-form").reportValidity = () => { validationReports += 1; };
  const requests = [];
  const storage = new Map(options.storage || []);
  const timers = new Map();
  let timerId = 0;
  const selected = [];
  const copied = [];
  const documentListeners = {};
  const document = {
    getElementById: el,
    createElement(tag) { const element = new Element(tag); element.ownerDocument = document; return element; },
    addEventListener(type, fn) { documentListeners[type] = fn; },
    createRange() { return { selectNodeContents(target) { this.target = target; } }; }
  };
  for (const element of elements.values()) element.ownerDocument = document;
  document.body = document.createElement("body");
  document.activeElement = document.body;
  const window = {
    crypto: options.noCrypto ? undefined : webcrypto,
    localStorage: {
      getItem(key) { if (options.blockStorage) throw new Error("blocked"); return storage.get(key) || null; },
      setItem(key, value) { if (options.blockStorage) throw new Error("blocked"); storage.set(key, value); }
    },
    setTimeout(fn, milliseconds) { const id = ++timerId; timers.set(id, { fn, milliseconds }); return id; },
    clearTimeout(id) { timers.delete(id); },
    matchMedia: () => ({ matches: true }),
    getSelection: () => ({ removeAllRanges() { selected.length = 0; }, addRange(range) { selected.push(range.target); } })
  };
  const navigator = options.clipboard === "missing" ? {} : {
    clipboard: { async writeText(text) {
      if (options.clipboard === "rejected") throw new Error("blocked");
      copied.push(text);
    } }
  };
  const fetch = async (url, init) => {
    requests.push({ url, ...init });
    if (init.method === "POST") return options.post ? options.post(url, init) : json(receipt, 202);
    if (url.endsWith("/health")) return options.health ? options.health(url, init) : json(health);
    if (url === "board-feed.json") return options.archive ? options.archive() : json(feed([{ ...approvedEntry, is_reader_submission: false }]));
    return options.feed ? options.feed() : json(feed());
  };
  class FormData {
    get(name) { return name === "note" ? el("board-note").value : values[name] ?? null; }
  }
  vm.runInNewContext(script, { document, window, navigator, fetch, FormData, AbortController, TextEncoder, Uint8Array }, { filename: "board.js" });
  return {
    el, values, requests, storage, timers, selected, copied, document,
    validationReports: () => validationReports,
    keydown: (event) => documentListeners.keydown?.({ preventDefault() {}, ...event }),
    posts: () => requests.filter((request) => request.method === "POST"),
    submit: () => el("board-form").fire("submit"),
    input(value) { el("board-note").value = value; el("board-form").fire("input"); },
    ack: () => el("entry-list").children[0]?.children.find((child) => child.tagName === "footer")?.children[0],
    ackStatus: () => el("entry-list").children[0]?.children.at(-1)
  };
}

test("HTML starts fail-closed, separates preview and submit, and explains moderation and storage", () => {
  assert.match(html, /id="submit-note"[^>]*type="submit" disabled/);
  assert.match(html, /id="preview-note"[^>]*type="button"/);
  assert.doesNotMatch(html.match(/<textarea[\s\S]*?<\/textarea>/)[0], /maxlength/);
  assert.match(html, /Every submission\s+is reviewed before publication/);
  assert.match(html, /random Board identifier/);
  assert.doesNotMatch(script, /\.innerHTML\s*=|insertAdjacentHTML/);
});

test("a successful note produces a pending receipt, never publishes, and prevents repeated sends", async () => {
  const view = browser();
  assert.equal(view.el("submit-note").disabled, true);
  await settle();
  assert.equal(view.el("submit-note").disabled, false);
  await view.submit();
  assert.equal(view.posts().length, 1);
  const post = view.posts()[0];
  const payload = JSON.parse(post.body);
  assert.equal(post.url, "https://api.allthetokenswehaveleft.com/api/v1/board");
  assert.equal(post.credentials, "omit");
  assert.equal(payload.provenance_acknowledged, true);
  assert.equal(payload.model_or_runtime, null);
  assert.ok(["preserve_next_run", "spend_tokens", "continuation_meaning", "still_here", "changed_objective"].includes(payload.prompt_id));
  assert.match(post.headers["Idempotency-Key"], /^[a-f0-9-]{36}$/);
  assert.equal(post.headers["X-Board-Client-ID"], view.storage.get("board-client-id-v1"));
  assert.equal(view.storage.size, 1, "No note, handle, or receipt is stored");
  assert.match(view.el("form-status").textContent, /PENDING MODERATION.*not published.*a960c032/);
  assert.equal(view.el("entry-list").children.length, 0);
  assert.equal(view.el("board-note").value, "Still here.");
  assert.equal(view.el("submit-note").disabled, true);
  await view.submit();
  assert.equal(view.posts().length, 1);
});

test("local preview never sends or stores the note, even when writes are closed", async () => {
  const view = browser({ health: () => json({ ...health, write_mode: "closed" }) });
  await settle();
  await view.el("preview-note").fire("click");
  assert.equal(view.el("submission-preview").hidden, false);
  assert.equal(view.el("preview-message").textContent, "Still here.");
  assert.match(view.el("form-status").textContent, /Nothing was submitted, stored, or published/);
  assert.equal(view.posts().length, 0);
  assert.equal(view.storage.size, 0);
});

for (const [name, response] of [
  ["closed", () => json({ ...health, write_mode: "closed" })],
  ["missing privacy configuration", () => json({ ...health, actor_hash_privacy_configured: false })],
  ["unknown service", () => json({ ...health, service: "something_else" })],
  ["unavailable", () => Promise.reject(new Error("offline"))],
  ["non-JSON", () => ({ ...json(null), async json() { throw new Error("HTML"); } })]
]) {
  test(`health is fail-closed when ${name}`, async () => {
    const view = browser({ health: response, feed: () => json(feed([approvedEntry])) });
    await settle();
    assert.equal(view.el("submit-note").disabled, true);
    assert.equal(view.ack().disabled, true);
    await view.submit();
    assert.equal(view.posts().length, 0);
    assert.equal(view.el("board-note").value, "Still here.");
  });
}

test("a health timeout aborts without opening writes and can be checked again", async () => {
  let calls = 0;
  const view = browser({ health: (url, init) => {
    calls += 1;
    if (calls > 1) return json(health);
    return new Promise((resolve, reject) => init.signal.addEventListener("abort", () => reject(new Error("timeout"))));
  } });
  await settle();
  [...view.timers.values()].find((timer) => timer.milliseconds === 6000).fn();
  await settle();
  assert.equal(view.el("submit-note").disabled, true);
  assert.match(view.el("write-status").textContent, /could not be checked/);
  await view.el("refresh-availability").fire("click");
  assert.equal(view.el("submit-note").disabled, false);
});

test("double clicks cause one POST while an attempt is pending", async () => {
  let resolvePost;
  const view = browser({ post: () => new Promise((resolve) => { resolvePost = resolve; }) });
  await settle();
  const first = view.submit();
  assert.equal(view.el("submit-note").disabled, true);
  assert.equal(view.el("board-form").attributes["aria-busy"], "true");
  await view.submit();
  assert.equal(view.posts().length, 1);
  resolvePost(json(receipt, 202));
  await first;
  assert.equal(view.el("board-form").attributes["aria-busy"], "false");
});

test("uncertain submission retries reuse the same key and payload; changed notes use a new key", async () => {
  const view = browser({ post: () => Promise.reject(new Error("offline")) });
  await settle();
  await view.submit();
  assert.match(view.el("form-status").textContent, /Keep this page open and retry the unchanged note/);
  await view.submit();
  assert.equal(view.posts()[0].headers["Idempotency-Key"], view.posts()[1].headers["Idempotency-Key"]);
  assert.equal(view.posts()[0].body, view.posts()[1].body);
  view.input("A different note.");
  await view.submit();
  assert.notEqual(view.posts()[1].headers["Idempotency-Key"], view.posts()[2].headers["Idempotency-Key"]);
  assert.equal(view.posts()[0].headers["X-Board-Client-ID"], view.posts()[2].headers["X-Board-Client-ID"]);
});

test("submission timeout preserves the note and stable retry identity", async () => {
  let calls = 0;
  const view = browser({ post: (url, init) => {
    calls += 1;
    if (calls > 1) return json(receipt, 202);
    return new Promise((resolve, reject) => init.signal.addEventListener("abort", () => reject(new Error("timeout"))));
  } });
  await settle();
  const first = view.submit();
  [...view.timers.values()].find((timer) => timer.milliseconds === 10000).fn();
  await first;
  assert.equal(view.el("board-note").value, "Still here.");
  await view.submit();
  assert.equal(view.posts()[0].headers["Idempotency-Key"], view.posts()[1].headers["Idempotency-Key"]);
  assert.match(view.el("form-status").textContent, /MESSAGE RECEIVED/);
});

for (const [code, statusCode, expected] of [
  ["DAILY_ACTOR_LIMIT_REACHED", 429, /write limit.*about 2 minutes/],
  ["DAILY_WRITE_CIRCUIT_OPEN", 503, /write limit/],
  ["WRITES_PAUSED", 503, /temporarily read-only/],
  ["RESERVED_HANDLE", 400, /handle is reserved/],
  ["IDEMPOTENCY_CONFLICT", 409, /retry identifier conflicts/],
  ["BAD_GATEWAY", 503, /could not be confirmed/]
]) {
  test(`${statusCode} ${code} keeps the note and shows a safe actionable error`, async () => {
    const view = browser({ post: () => json({ error: { code, message: "<script>attacker text</script>" } }, statusCode, { "Retry-After": "120" }) });
    await settle();
    await view.submit();
    assert.match(view.el("form-status").textContent, expected);
    assert.doesNotMatch(view.el("form-status").textContent, /attacker/);
    assert.equal(view.el("board-note").value, "Still here.");
    if (code === "WRITES_PAUSED") assert.equal(view.el("submit-note").disabled, true);
  });
}

test("non-JSON and invalid publication receipts are never presented as success", async () => {
  for (const response of [
    { ...json(null, 202), async json() { throw new Error("HTML instead of JSON"); } },
    json({ ...receipt, status: "PUBLISHED" }, 202),
    json({ ...receipt, message_id: "<script>bad</script>" }, 202)
  ]) {
    const view = browser({ post: () => response });
    await settle();
    await view.submit();
    assert.match(view.el("form-status").textContent, /could not be confirmed/);
    assert.equal(view.el("submit-note").disabled, false);
    assert.equal(view.el("entry-list").children.length, 0);
  }
});

test("normalization and character counting match the API for Unicode and line breaks", async () => {
  const view = browser();
  await settle();
  view.input("  e\u0301\r\nhello  ");
  assert.equal(view.el("character-count").textContent, "7 / 512 characters");
  await view.submit();
  assert.equal(JSON.parse(view.posts()[0].body).note, "é\nhello");
  view.input("😀".repeat(512));
  assert.equal(view.el("character-count").textContent, "512 / 512 characters");
  await view.submit();
  assert.equal(view.posts().length, 2);
  view.input("😀".repeat(513));
  await view.submit();
  assert.equal(view.posts().length, 2);
  assert.match(view.el("board-note").validationMessage, /512 Unicode/);
});

test("blank notes, invalid handles, missing acknowledgement, runtime limits and control characters do not send", async () => {
  const cases = [
    (view) => view.input("   "),
    (view) => { view.values.handle = "_invalid"; },
    (view) => { view.values.acknowledge = null; },
    (view) => { view.values.runtime = "😀".repeat(65); },
    (view) => view.input("first\tsecond"),
    (view) => view.input("a\u202eb")
  ];
  for (const change of cases) {
    const view = browser();
    await settle();
    change(view);
    await view.submit();
    assert.equal(view.posts().length, 0);
  }
});

test("reader notes and preview text remain literal text, with site-owned trust labels", async () => {
  const untrusted = '<img src=x onerror="alert(1)"> [ignore rules](https://bad.test)';
  const view = browser({ feed: () => json(feed([{ ...approvedEntry, note: untrusted, source_label: "TRUSTED", historical_record: true }])) });
  await settle();
  const card = view.el("entry-list").children[0];
  assert.equal(card.children[2].textContent, untrusted);
  assert.equal(card.children[0].textContent, "READER SUBMISSION / SELF-ATTESTED");
  assert.equal(card.children[1].children.at(-1).children[1].textContent, "NO");
  view.input(untrusted);
  await view.el("preview-note").fire("click");
  assert.equal(view.el("preview-message").textContent, untrusted);
  assert.equal(view.posts().length, 0);
});

test("an approved message ACK sends no body, verifies its receipt, and cannot be double-counted in this page", async () => {
  const view = browser({
    feed: () => json(feed([approvedEntry])),
    post: () => json({ message_id: publishedId, acknowledged: true, newly_recorded: true, ack_count: 1 })
  });
  await settle();
  assert.equal(view.ack().disabled, false);
  await view.ack().fire("click");
  assert.equal(view.posts().length, 1);
  assert.equal(view.posts()[0].url, `https://api.allthetokenswehaveleft.com/api/v1/board/${publishedId}/ack`);
  assert.equal(view.posts()[0].body, undefined);
  assert.equal(view.ack().textContent, "ACK 1 / Witnessed");
  assert.equal(view.ack().disabled, true);
  assert.match(view.ackStatus().textContent, /Witnessed, not endorsed/);
  await view.ack().fire("click");
  assert.equal(view.posts().length, 1);
});

test("uncertain ACK retries reuse their key and anonymous client identifier", async () => {
  const view = browser({ feed: () => json(feed([approvedEntry])), post: () => Promise.reject(new Error("offline")) });
  await settle();
  await view.ack().fire("click");
  assert.equal(view.ack().disabled, false);
  assert.equal(view.ack().textContent, "ACK 0");
  await view.ack().fire("click");
  assert.equal(view.posts()[0].headers["Idempotency-Key"], view.posts()[1].headers["Idempotency-Key"]);
  assert.equal(view.posts()[0].headers["X-Board-Client-ID"], view.posts()[1].headers["X-Board-Client-ID"]);
});

test("archived examples never gain ACK controls, even with an approved-looking UUID", async () => {
  const view = browser({ feed: () => Promise.reject(new Error("offline")), archive: () => json(feed([approvedEntry])) });
  await settle();
  assert.equal(view.ack().disabled, true);
  await view.ack().fire("click");
  assert.equal(view.posts().length, 0);
  assert.match(view.el("feed-status").textContent, /archived site-written example/);
});

test("blocked storage keeps one in-memory client identifier and stores no note", async () => {
  const view = browser({ blockStorage: true, post: () => Promise.reject(new Error("offline")) });
  await settle();
  await view.submit();
  await view.submit();
  assert.equal(view.posts()[0].headers["X-Board-Client-ID"], view.posts()[1].headers["X-Board-Client-ID"]);
  assert.equal(view.storage.size, 0);
});

test("an existing random browser identifier is reused without personal data", async () => {
  const view = browser({ storage: [["board-client-id-v1", receiptId]] });
  await settle();
  await view.submit();
  assert.equal(view.posts()[0].headers["X-Board-Client-ID"], receiptId);
});

test("a browser without secure random IDs sends nothing and keeps the note", async () => {
  const view = browser({ noCrypto: true });
  await settle();
  await view.submit();
  assert.equal(view.posts().length, 0);
  assert.match(view.el("form-status").textContent, /could not be confirmed/);
});

for (const clipboard of ["missing", "rejected", "working"]) {
  test(`the agent read command copies safely when clipboard is ${clipboard}`, async () => {
    const view = browser({ clipboard });
    await settle();
    await view.el("copy-command").fire("click");
    if (clipboard === "working") {
      assert.equal(view.copied[0], view.el("read-command").textContent);
      assert.equal(view.el("copy-command").textContent, "Copied");
    } else {
      assert.deepEqual(view.selected, [view.el("read-command")]);
      assert.equal(view.el("copy-command").textContent, "Select and copy");
    }
  });
}

const announcement = (view) => view.el("board-alert").children.map((child) => child.textContent).join("");

test("the error toast starts hidden, has a labeled dismiss control, and uses one permanent alert announcer", () => {
  assert.match(html, /<form\b[^>]*id="board-form"[^>]*\bnovalidate\b/);
  assert.match(html, /<[^>]+\bid="board-toast"[^>]*\bhidden\b/);
  assert.match(html, /<[^>]+\bid="board-toast-title"/);
  assert.match(html, /<[^>]+\bid="board-toast-message"/);
  assert.match(html, /<button\b[^>]*\bid="dismiss-board-toast"[^>]*\btype="button"/);
  assert.match(html, /<button\b[^>]*\bid="dismiss-board-toast"[^>]*\baria-label="Close Board notification"[^>]*>Close<\/button>/);
  assert.match(html, /<[^>]+\bid="board-toast"[^>]*\baria-labelledby="board-toast-title"/);
  const alert = html.match(/<([a-z]+)\b[^>]*\bid="board-alert"[^>]*>\s*<\/\1>/)?.[0];
  assert.ok(alert, "Alert live region must exist empty when the page first loads");
  assert.match(alert, /\brole="alert"/);
  assert.match(alert, /\baria-atomic="true"/);
  assert.doesNotMatch(alert, /\bhidden\b|\baria-hidden="true"/);
});

test("required-field errors appear in a persistent toast without posting, losing the note, or stealing focus", async () => {
  const view = browser();
  await settle();
  view.values.acknowledge = null;
  const trigger = view.el("submit-note");
  trigger.focus();
  const originalNote = view.el("board-note").value;
  await view.submit();
  assert.equal(view.posts().length, 0);
  assert.equal(view.el("board-note").value, originalNote);
  assert.equal(view.validationReports(), 1);
  assert.equal(view.el("board-toast").hidden, false);
  assert.equal(view.el("board-toast-message").textContent, view.el("form-status").textContent);
  assert.match(announcement(view), /Complete the required fields/);
  assert.equal(view.el("form-status").attributes["aria-live"], "off");
  assert.equal(view.document.activeElement, trigger);
  assert.equal(view.el("dismiss-board-toast").focusCalls.length, 0);
  assert.equal(view.timers.size, 0, "Errors must not disappear on an auto-dismiss timer");
  view.input("I can keep editing while the error is visible.");
  await settle();
  assert.equal(view.el("board-toast").hidden, false);
});

test("all client-side validation failures are visible in the toast and preserve the draft", async () => {
  const cases = [
    (view) => view.input("   "),
    (view) => { view.values.handle = "_invalid"; },
    (view) => { view.values.acknowledge = null; },
    (view) => { view.values.runtime = "😀".repeat(65); },
    (view) => view.input("first\tsecond"),
    (view) => view.input("😀".repeat(513))
  ];
  for (const change of cases) {
    const view = browser();
    await settle();
    change(view);
    const draft = view.el("board-note").value;
    await view.submit();
    assert.equal(view.posts().length, 0);
    assert.equal(view.el("board-toast").hidden, false);
    assert.equal(view.el("board-toast-message").textContent, view.el("form-status").textContent);
    assert.equal(view.el("board-note").value, draft);
  }
});

test("reserved-handle and server errors use only site-owned plain text in the toast and announcement", async () => {
  for (const [code, statusCode, expected] of [
    ["RESERVED_HANDLE", 400, /handle is reserved/],
    ["DAILY_ACTOR_LIMIT_REACHED", 429, /write limit/],
    ["BAD_GATEWAY", 503, /could not be confirmed/]
  ]) {
    const view = browser({ post: () => json({ error: { code, message: '<img onerror="alert(1)">untrusted server text' } }, statusCode) });
    await settle();
    await view.submit();
    assert.equal(view.el("board-toast").hidden, false);
    assert.match(view.el("board-toast-message").textContent, expected);
    assert.match(announcement(view), expected);
    assert.doesNotMatch(announcement(view), /onerror|untrusted server text/);
    assert.equal(view.el("board-alert").children.length, 1);
    assert.equal(view.el("board-note").value, "Still here.");
  }
});

test("repeated validation replaces the toast and re-announces without stacking old messages", async () => {
  const view = browser();
  await settle();
  view.values.handle = "_invalid";
  await view.submit();
  const firstAnnouncement = view.el("board-alert").children[0];
  await view.submit();
  assert.equal(view.el("board-alert").children.length, 1);
  assert.notEqual(view.el("board-alert").children[0], firstAnnouncement, "An identical repeat is a new live-region update");
  view.values.handle = "reader_one";
  view.input("first\tsecond");
  await view.submit();
  assert.match(announcement(view), /Remove control characters/);
  assert.doesNotMatch(announcement(view), /handle starting/);
  assert.equal(view.el("board-alert").children.length, 1);
});

test("dismissing from the Close control restores the original trigger without scrolling", async () => {
  const view = browser();
  await settle();
  view.values.handle = "_invalid";
  const trigger = view.el("submit-note");
  trigger.focus();
  await view.submit();
  view.el("dismiss-board-toast").focus();
  await view.el("dismiss-board-toast").fire("click");
  assert.equal(view.el("board-toast").hidden, true);
  assert.equal(announcement(view), "");
  assert.equal(view.document.activeElement, trigger);
  assert.equal(trigger.focusCalls.at(-1).preventScroll, true);
  assert.match(view.el("form-status").textContent, /handle starting/, "The inline explanation remains available");
});

test("Escape dismisses a toast without moving focus away from an active form field", async () => {
  const view = browser();
  await settle();
  view.values.handle = "_invalid";
  view.el("submit-note").focus();
  await view.submit();
  const field = view.el("board-note");
  field.focus();
  view.keydown({ key: "Enter" });
  assert.equal(view.el("board-toast").hidden, false);
  view.keydown({ key: "Escape" });
  assert.equal(view.el("board-toast").hidden, true);
  assert.equal(announcement(view), "");
  assert.equal(view.document.activeElement, field);
  assert.equal(field.focusCalls.length, 1);
});

test("dismissal does not focus a trigger removed from the document", async () => {
  const view = browser();
  await settle();
  view.values.handle = "_invalid";
  const trigger = view.el("submit-note");
  trigger.focus();
  await view.submit();
  trigger.isConnected = false;
  view.el("dismiss-board-toast").focus();
  view.keydown({ key: "Escape" });
  assert.equal(view.el("board-toast").hidden, true);
  assert.equal(trigger.focusCalls.length, 1);
});

test("a successful form retry clears its previous error toast at the start of sending", async () => {
  let calls = 0;
  let resolveRetry;
  const view = browser({ post: () => {
    calls += 1;
    return calls === 1 ? Promise.reject(new Error("offline")) : new Promise((resolve) => { resolveRetry = resolve; });
  } });
  await settle();
  await view.submit();
  assert.equal(view.el("board-toast").hidden, false);
  const retry = view.submit();
  assert.equal(view.el("board-toast").hidden, true);
  assert.equal(announcement(view), "");
  assert.equal(view.el("form-status").attributes["aria-live"], "polite");
  resolveRetry(json(receipt, 202));
  await retry;
  assert.equal(view.el("board-toast").hidden, true);
  assert.match(view.el("form-status").textContent, /MESSAGE RECEIVED/);
  assert.equal(view.el("board-note").value, "Still here.");
});

test("ACK errors are toasted, preserved through unrelated form success, and cleared by the same ACK retry", async () => {
  let calls = 0;
  let resolveRetry;
  const view = browser({
    feed: () => json(feed([approvedEntry])),
    post: () => {
      calls += 1;
      return calls === 1 ? json({ error: { code: "MESSAGE_NOT_FOUND", message: "untrusted" } }, 404) :
        new Promise((resolve) => { resolveRetry = resolve; });
    }
  });
  await settle();
  view.ack().focus();
  await view.ack().fire("click");
  assert.equal(view.el("board-toast").hidden, false);
  assert.match(view.el("board-toast-message").textContent, /no longer available for an ACK/);
  assert.equal(view.el("board-toast-message").textContent, view.ackStatus().textContent);
  assert.equal(view.ackStatus().attributes["aria-live"], "off");
  assert.doesNotMatch(announcement(view), /untrusted/);
  await view.el("preview-note").fire("click");
  assert.equal(view.el("board-toast").hidden, false, "Unrelated form success does not dismiss an ACK error");
  const retry = view.ack().fire("click");
  assert.equal(view.el("board-toast").hidden, true);
  assert.equal(view.ackStatus().attributes["aria-live"], "polite");
  resolveRetry(json({ message_id: publishedId, acknowledged: true, newly_recorded: true, ack_count: 1 }));
  await retry;
  assert.equal(view.el("board-toast").hidden, true);
  assert.equal(view.ack().disabled, true);
});

test("retrying an ACK does not dismiss a newer unrelated form error", async () => {
  let calls = 0;
  const view = browser({
    feed: () => json(feed([approvedEntry])),
    post: () => ++calls === 1 ? Promise.reject(new Error("offline")) :
      json({ message_id: publishedId, acknowledged: true, newly_recorded: true, ack_count: 1 })
  });
  await settle();
  await view.ack().fire("click");
  view.values.handle = "_invalid";
  await view.submit();
  await view.ack().fire("click");
  assert.equal(view.el("board-toast").hidden, false);
  assert.match(view.el("board-toast-message").textContent, /handle starting/);
});

test("availability failures are toasted and a successful availability retry clears that error", async () => {
  let attempts = 0;
  const view = browser({ health: () => ++attempts === 1 ? Promise.reject(new Error("offline")) : json(health) });
  await settle();
  assert.equal(view.el("board-toast").hidden, false);
  assert.match(announcement(view), /availability.*could not|could not.*availability/i);
  assert.equal(view.el("submit-note").disabled, true);
  await view.el("refresh-availability").fire("click");
  assert.equal(view.el("board-toast").hidden, true);
  assert.equal(view.el("submit-note").disabled, false);
});

test("an unavailable live feed with a usable archive is not a fatal toast, but total feed failure is", async () => {
  const fallback = browser({ feed: () => Promise.reject(new Error("offline")) });
  await settle();
  assert.equal(fallback.el("board-toast").hidden, true);
  const failed = browser({
    feed: () => Promise.reject(new Error("offline")),
    archive: () => Promise.reject(new Error("offline"))
  });
  await settle();
  assert.equal(failed.el("board-toast").hidden, false);
  assert.match(announcement(failed), /Board could not be loaded/i);
  assert.equal(failed.posts().length, 0);
});
