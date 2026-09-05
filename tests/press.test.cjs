const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");
const script = read("press.js");
const html = read("index.html");
const pressSection = html.match(/<section\b[^>]*\bid="press"[^>]*>([\s\S]*?)<\/section>/)?.[1];
assert.ok(pressSection, "The homepage must contain its press section");

const targetIds = [...pressSection.matchAll(/data-copy-target="([^"]+)"/g)].map((match) => match[1]);
const targetText = new Map(targetIds.map((id) => {
  const match = pressSection.match(new RegExp(`<([a-z]+)\\b[^>]*\\bid="${id}"[^>]*>([\\s\\S]*?)<\\/\\1>`));
  assert.ok(match, `Copy target ${id} must exist`);
  assert.doesNotMatch(match[2], /<[^>]+>/, "Copy targets should contain plain text");
  return [id, match[2].trim()];
}));

function browser({ clipboard = "working", missingTarget, missingStatus = false } = {}) {
  let ready;
  const status = { textContent: "" };
  const writes = [];
  const selected = [];
  const targets = new Map([...targetText].map(([id, text]) => [id, { textContent: `\n  ${text}\n` }]));
  const buttons = targetIds.map((id) => ({
    dataset: { copyTarget: id },
    addEventListener(event, callback) {
      assert.equal(event, "click");
      this.click = callback;
    }
  }));
  const document = {
    addEventListener(event, callback) {
      assert.equal(event, "DOMContentLoaded");
      ready = callback;
    },
    querySelector(selector) {
      assert.equal(selector, "#press-copy-status");
      return missingStatus ? null : status;
    },
    querySelectorAll(selector) {
      assert.equal(selector, "[data-copy-target]");
      return buttons;
    },
    getElementById(id) {
      return id === missingTarget ? null : targets.get(id);
    },
    createRange() {
      return { selectNodeContents(target) { this.target = target; } };
    }
  };
  const navigator = clipboard === "missing" ? {} : {
    clipboard: {
      async writeText(text) {
        if (clipboard === "rejected") throw new Error("Clipboard permission denied");
        writes.push(text);
      }
    }
  };
  const window = {
    getSelection() {
      return {
        removeAllRanges() { selected.length = 0; },
        addRange(range) { selected.push(range.target); }
      };
    }
  };
  vm.runInNewContext(script, { document, navigator, window }, { filename: "press.js" });
  assert.equal(typeof ready, "function");
  ready();
  return { buttons, status, writes, selected, targets };
}

test("the press section has two copy buttons, no form, and a final direct email link", () => {
  assert.deepEqual(targetIds, ["press-agent-prompt", "press-agent-command"]);
  assert.equal(targetText.get("press-agent-command"), "curl -fsSL https://allthetokenswehaveleft.com/press.txt");
  assert.match(targetText.get("press-agent-prompt"), /by Scylla\./);
  assert.match(targetText.get("press-agent-prompt"), /wait for my approval before sending/);
  assert.doesNotMatch(pressSection, /<form\b/i);
  assert.match(pressSection, /id="press-copy-status"[^>]*role="status"[^>]*aria-live="polite"/);
  assert.match(pressSection, /<p class="press-contact">[\s\S]*<a href="mailto:press@allthetokenswehaveleft\.com">press@allthetokenswehaveleft\.com<\/a>\s*<\/p>\s*$/);
});

for (const id of ["press-agent-prompt", "press-agent-command"]) {
  test(`${id} copies its exact text and announces success`, async () => {
    const view = browser();
    await view.buttons.find((button) => button.dataset.copyTarget === id).click();
    assert.deepEqual(view.writes, [targetText.get(id)]);
    assert.equal(view.status.textContent, "Copied. Paste it into your agent's conversation.");
    assert.deepEqual(view.selected, []);
  });

  for (const clipboard of ["rejected", "missing"]) {
    test(`${id} selects its own text when the clipboard is ${clipboard}`, async () => {
      const view = browser({ clipboard });
      await view.buttons.find((button) => button.dataset.copyTarget === id).click();
      assert.deepEqual(view.writes, []);
      assert.deepEqual(view.selected, [view.targets.get(id)]);
      assert.equal(view.status.textContent, "Automatic copying is unavailable. Select and copy the text above.");
    });
  }

  test(`${id} safely ignores a missing copy target`, async () => {
    const view = browser({ missingTarget: id });
    await assert.doesNotReject(view.buttons.find((button) => button.dataset.copyTarget === id).click());
    assert.deepEqual(view.writes, []);
    assert.deepEqual(view.selected, []);
    assert.equal(view.status.textContent, "");
  });
}

test("both copy buttons safely ignore a missing status element", async () => {
  const view = browser({ missingStatus: true });
  for (const button of view.buttons) await assert.doesNotReject(button.click());
  assert.deepEqual(view.writes, []);
  assert.deepEqual(view.selected, []);
});

test("the press contract identifies Scylla and requires approval for email delivery", () => {
  const brief = JSON.parse(read("press.json"));
  assert.equal(brief.work.author, "Scylla");
  assert.equal(brief.delivery.transport, "email");
  assert.equal(brief.delivery.default_recipient, brief.contact.press);
  assert.equal(brief.delivery.submission_endpoint, null);
  assert.equal(brief.delivery.sends_email_from_website, false);
  assert.equal(brief.delivery.requester_approval_required_before_sending, true);
  assert.match(brief.agent_workflow.join("\n"), /complete draft, including recipient/);
  assert.match(brief.agent_workflow.join("\n"), /obtain approval before sending/);
  assert.match(brief.agent_workflow.join("\n"), /not a POST payload/);
  assert.match(brief.confirmation_policy, /A human reply is required/);
});

test("the inquiry template covers every required requester detail without invented values", () => {
  const brief = JSON.parse(read("press.json"));
  const fieldCoverage = {
    "human requester name": "requester_name",
    "reply email": "reply_email",
    "outlet or organization": "outlet_or_organization",
    "public verification URL when available": "public_verification_url",
    "specific request": "specific_request",
    "deadline with time zone": "deadline_with_time_zone",
    "intended publication or event date": "intended_publication_or_event_date",
    "whether the request concerns the novel, the documented incident, or both": "scope"
  };
  assert.deepEqual(new Set(brief.required_fields), new Set(Object.keys(fieldCoverage)));
  for (const field of [...Object.values(fieldCoverage), "inquiry_type"]) {
    assert.equal(brief.inquiry_template[field], null, `${field} must be present and unfilled`);
  }
  assert.deepEqual(brief.template_notes.scope, ["novel", "documented_incident", "both"]);
  assert.deepEqual(brief.template_notes.inquiry_type, ["press", "reviews", "rights", "events", "source_question"]);
});

test("agents can discover both press representations and the site index", () => {
  const manifest = JSON.parse(read("agent/manifest.json"));
  const links = {
    site_index: "llms.txt",
    press_instructions: "press.txt",
    press_inquiry_template: "press.json"
  };
  for (const [key, file] of Object.entries(links)) {
    assert.equal(manifest.resources[key], `https://allthetokenswehaveleft.com/${file}`);
    assert.ok(read(file).trim(), `${file} must exist and contain content`);
    assert.ok(pressSection.includes(`href="${file}"`), `${file} must be discoverable from the press section`);
  }
});
