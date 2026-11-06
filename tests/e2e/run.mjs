// End-to-end check of the built Chrome extension against a stand-in GitHub page.
// Network requests to github.com are answered locally, so no account is used.
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const extension = resolve(".output/chrome-mv3");
const base = "a".repeat(40);
const head = "b".repeat(40);
const source = {
  [base]: "# Guide\n\nKeep this. Old words here.\n\nRepeat me.\n",
  [head]: "# Guide\n\nKeep this. New words here.\n\nRepeat me.\n\nRepeat me.\n",
};

const page = `<!doctype html><html><head><title>PR</title></head><body>
<div id="diff-0f00">
  <div class="prose-diff">
    <h1>Guide</h1>
    <p>Keep this. <del>Old words here.</del><ins>New words here.</ins></p>
    <p>Repeat me.</p>
    <p><ins>Repeat me.</ins></p>
  </div>
</div>
</body></html>`;

const posts = [];
const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), "margink-")), {
  channel: "chromium",
  headless: true,
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
});
await context.route("https://github.com/**", async (route) => {
  const req = route.request();
  const url = new URL(req.url());
  if (url.pathname === "/o/r/pull/1/files") return route.fulfill({ contentType: "text/html", body: page });
  if (url.pathname === "/o/r/pull/1/changes") {
    return route.fulfill({ json: { payload: { comparison: { fullDiff: { baseOid: base, headOid: head } }, diffSummaries: [{ path: "docs/guide.md", pathDigest: "0f00" }] } } });
  }
  const raw = /^\/o\/r\/raw\/([0-9a-f]+)\/docs\/guide\.md$/.exec(url.pathname);
  if (raw) return route.fulfill({ contentType: "text/plain", body: source[raw[1]] });
  if (url.pathname === "/o/r/pull/1/page_data/create_review_comment" && req.method() === "POST") {
    posts.push(JSON.parse(req.postData()));
    await new Promise((r) => setTimeout(r, 300));
    return route.fulfill({ json: { thread: { commentsData: { comments: [{ url: "https://github.com/o/r/pull/1#discussion_r1" }] } } } });
  }
  return route.fulfill({ status: 404, body: "" });
});

const tab = await context.newPage();
await tab.goto("https://github.com/o/r/pull/1/files");
await tab.waitForTimeout(500);

async function select(text, nth = 0) {
  await tab.evaluate(([text, nth]) => {
    const walker = document.createTreeWalker(document.querySelector(".prose-diff"), NodeFilter.SHOW_TEXT);
    let seen = 0;
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const at = n.data.indexOf(text);
      if (at >= 0 && seen++ === nth) {
        const r = document.createRange();
        r.setStart(n, at);
        r.setEnd(n, at + text.length);
        const sel = getSelection();
        sel.removeAllRanges();
        sel.addRange(r);
        document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
        return;
      }
    }
    throw new Error("not found " + text);
  }, [text, nth]);
  await tab.locator('[data-margink-ui="trigger"]').click();
}
const box = () => tab.locator('[data-margink-ui="comment-box"]');
const mod = process.platform === "darwin" ? "Meta" : "Control";

// 1. Removed text is commented on the base version.
await select("Old words");
await assert.doesNotReject(box().locator(".where", { hasText: "line 3 (before the change)" }).waitFor({ timeout: 5000 }));
await box().locator("textarea").fill("Why remove this?");
// Repeated confirmation while posting starts only one request.
await box().locator("textarea").press(`${mod}+Enter`);
await box().locator("textarea").press(`${mod}+Enter`).catch(() => {});
await tab.locator('[data-margink-ui="marker"]').first().waitFor({ timeout: 5000 });
assert.equal(posts.length, 1);
assert.equal(posts[0].side, "left");
assert.equal(posts[0].line, 3);
assert.equal(posts[0].positioning.commitOid, base);
assert.equal(posts[0].text, "> Old words\n\nWhy remove this?");
assert.equal(await box().count(), 0, "box closes after success");

// 2. The second "Repeat me." maps to head line 7.
await select("Repeat me.", 1);
await box().locator(".where", { hasText: "line 7 (after the change)" }).waitFor({ timeout: 5000 });

// 3. A blank comment is not posted and the box stays.
await box().locator("textarea").fill("   ");
await box().locator(".confirm").click({ force: true });
await box().locator(".status", { hasText: "Write a comment first." }).waitFor({ timeout: 5000 });
assert.equal(posts.length, 1);

// 4. Enter inserts a newline; IME composition is covered by unit tests.
await box().locator("textarea").fill("line one");
await box().locator("textarea").press("Enter");
assert.equal(await box().locator("textarea").inputValue(), "line one\n");
assert.equal(posts.length, 1);

await tab.screenshot({ path: process.env.SCREENSHOT ?? join(tmpdir(), "margink-e2e.png") });
await context.close();
console.log("e2e: all checks passed");
