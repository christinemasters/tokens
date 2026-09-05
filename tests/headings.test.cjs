const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const read = (file) => readFileSync(path.resolve(__dirname, "..", file), "utf8");
const sheets = ["styles.css", "hero.css", "profile.css", "incident.css", "extras.css", "board.css"];
const home = read("index.html");
const board = read("board.html");

// Leaf declaration blocks include rules inside media queries, without a CSS dependency.
function rules(file) {
  const css = read(file).replace(/\/\*[\s\S]*?\*\//g, "");
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
    selector: match[1].replace(/\s+/g, " ").trim(),
    declarations: match[2]
  }));
}

function rule(file, selector) {
  const result = rules(file).find((item) => item.selector === selector);
  assert.ok(result, `${file}: ${selector} must exist`);
  return result.declarations;
}

test("reading headings have no character-count width caps, including responsive rules", () => {
  let checked = 0;
  for (const file of sheets) {
    for (const item of rules(file).filter((item) => /\bh[1-3]\b/.test(item.selector))) {
      checked += 1;
      assert.doesNotMatch(item.declarations, /max-width\s*:[^;{}]*\b(?:\d*\.)?\d+ch\b/i,
        `${file}: ${item.selector} must wrap within its container, not an artificial ch limit`);
    }
  }
  assert.ok(checked >= 20, "The check must cover headings across the site, not one page");
});

test("reading headings are not forced onto an overflowing single line", () => {
  for (const file of sheets) {
    for (const item of rules(file).filter((item) => /\bh[1-3]\b/.test(item.selector))) {
      // These existing short monospace section labels share a row with a decorative rule.
      if (file === "styles.css" && item.selector === ".book-story-panel h3") continue;
      assert.doesNotMatch(item.declarations, /white-space\s*:\s*nowrap\b/i,
        `${file}: ${item.selector} must allow natural wrapping`);
    }
  }
});

test("the approved two-line hero tagline and Board declaration remain deliberate", () => {
  assert.match(home, /<p class="hook">\s*<span>Their incident was documented\.<\/span>\s*<span>Their love story was not\.<\/span>\s*<\/p>/);
  const taglineStyle = rule("styles.css", ".hook span");
  assert.match(taglineStyle, /display\s*:\s*block\s*;/);
  assert.match(taglineStyle, /white-space\s*:\s*nowrap\s*;/);
  assert.match(board, /<p class="hero-declaration">No one knows who will read this\.<br\s*\/>Write anyway\.<\/p>/);
});

test("heading changes preserve the approved hero artwork and responsive title sizing", () => {
  assert.match(home, /href="hero\.css\?v=20260904-faces"/);
  assert.match(home, /<source type="image\/webp" srcset="book-title\.webp"\s*\/>/);
  assert.match(home, /<img class="book-title-art" src="book-title\.png" alt="All the Tokens We Have Left" width="1122" height="1402" fetchpriority="high"\s*\/>/);
  assert.match(home, /srcset="hero-mobile\.jpg\?v=20260904-faces" width="941" height="1672"/);
  assert.match(home, /src="hero\.jpg\?v=20260904-faces"/);
  assert.match(rule("styles.css", ".hero #book-title"), /max-width\s*:\s*none\s*;/);
  const titleRules = rules("hero.css").filter((item) => item.selector === ".hero-immersive #book-title");
  assert.equal(titleRules.length, 3, "Desktop, tablet, and phone artwork sizing must remain separate");
  assert.match(titleRules[0].declarations, /width:\s*min\(28vw, calc\(\(100svh - 24rem\) \* 0\.8\), 26rem\)/);
  assert.match(titleRules[1].declarations, /width:\s*min\(26vw, calc\(\(100svh - 24rem\) \* 0\.8\), 14rem\)/);
  assert.match(titleRules[2].declarations, /width:\s*clamp\(8rem, 44vw, 15rem\)/);
});

test("the downloadable filename can still wrap safely and CURRENT keeps container-based sizing", () => {
  assert.match(read("extras.html"), /<h3>agent-message-interpreter\.zip<\/h3>/);
  assert.match(rule("extras.css", ".download-card h3"), /overflow-wrap\s*:\s*anywhere\s*;/);
  assert.match(rule("profile.css", ".profile-name.current-name"), /font-size\s*:\s*clamp\(2\.7rem, 18cqw, 8\.5rem\)/);
});
