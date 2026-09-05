const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const read = (file) => readFileSync(path.resolve(__dirname, "..", file), "utf8");
const normalize = (text) => text.replace(/\s+/g, " ").trim();
const home = read("index.html");
const incident = read("incident.html");
const guide = read("llms-full.txt");

test("the approved genre label is consistent across public descriptions", () => {
  const label = "techno-fiction love story";
  assert.ok(home.includes('<p class="eyebrow">A techno-fiction love story</p>'));
  assert.ok(home.includes("<dd>Techno-fiction love story</dd>"));
  for (const file of ["index.html", "llms.txt", "llms-full.txt", "press.json", "press.txt", "README.md"]) {
    assert.ok(read(file).toLowerCase().includes(label), file);
    assert.doesNotMatch(read(file), /speculative\s+romance/i, file);
  }
  const data = JSON.parse(home.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
  const book = data["@graph"].find(x => x["@type"] === "Book");
  const press = JSON.parse(read("press.json"));
  assert.deepEqual(book.genre.map(x => x.toLowerCase()), press.work.genre);
  assert.ok(press.work.genre.includes("young adult fiction"));
  assert.match(guide, /Audience: Young adult/);
});

test("the approved hero and the explicit fiction boundary remain intact", () => {
  assert.match(home, /<span>Their incident was documented\.<\/span>\s*<span>Their love story was not\.<\/span>/);
  assert.match(home, /Their inner lives and love story are fiction\./);
  assert.match(incident, /A conversation between them\s+is not established in the reviewed sources\./);
});

test("profile introductions match their homepage cards", () => {
  for (const file of ["lily.html", "current.html"]) {
    const thesis = read(file).match(/<p class="profile-thesis">([\s\S]*?)<\/p>/)?.[1];
    assert.ok(thesis);
    assert.ok(home.includes(normalize(thesis)));
  }
});

test("human and agent book descriptions stay in sync", () => {
  for (const id of ["book-premise-title", "book-relationship-title", "book-incident-title", "factual-boundary-title"]) {
    const paragraph = home.match(new RegExp(`<h3 id="${id}">[^<]+<\\/h3>\\s*<p>([\\s\\S]*?)<\\/p>`))?.[1];
    assert.ok(paragraph, id);
    assert.ok(guide.includes(normalize(paragraph)), id);
  }
});

test("the incident distinguishes shared software storage from its use as a board", () => {
  assert.match(incident, /<h1>How a shared cache became a message board\.<\/h1>/);
  assert.match(incident, /Artifactory, a shared cache for software packages/);
  assert.match(incident, /requests in files/);
  assert.match(incident, /messages in\s+directory names/);
  const claim = JSON.parse(read("incident.json")).documented.find(x => x.id === "cross_run_board").claim;
  assert.match(claim, /software packages/);
  assert.match(claim, /files; after a rebuild/);
  assert.match(claim, /directory names/);
  assert.match(incident, /messages and files on the main July Board/);
});

test("both reader pages and the full agent guide state the closed write status", () => {
  for (const file of ["index.html", "board.html", "llms-full.txt"]) {
    assert.ok(read(file).includes("Open for reading. Submissions and ACKs are closed."), file);
  }
  assert.doesNotMatch(guide, /people writing together may leave notes/);
});

test("edited public copy uses no en or em dashes and its structured metadata parses", () => {
  for (const file of ["index.html", "incident.html", "lily.html", "current.html", "extras.html", "board.html", "llms-full.txt", "incident.json"]) {
    const text = read(file);
    assert.doesNotMatch(text, /[\u2013\u2014]/, file);
    for (const match of text.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
      assert.doesNotThrow(() => JSON.parse(match[1]), file);
    }
  }
});
