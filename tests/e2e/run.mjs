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
  [head]: "# Guide\n\nKeep this. New words here.\n\nRepeat me.\n\nRepeat me.\n\nUse the Node version in the version file and pnpm from the package manager field.\nCI reads the version file through the setup action, and local checks do not replace CI.\n",
};

const page = `<!doctype html><html><head><title>PR</title><meta name="user-login" content="octocat"></head><body style="font-family: sans-serif; max-width: 520px; margin: 24px; font-size: 16px; line-height: 1.6">
<div id="diff-0f00">
  <div class="prose-diff">
    <h1>Guide</h1>
    <p>Keep this. <del>Old words here.</del><ins>New words here.</ins></p>
    <p>Repeat me.</p>
    <p><ins>Repeat me.</ins></p>
    <p><ins>Use the Node version in the version file and pnpm from the package manager field. CI reads the version file through the setup action, and local checks do not replace CI.</ins></p>
  </div>
</div>
<script>window.pageShortcuts = []; document.addEventListener("keydown", (e) => window.pageShortcuts.push(e.key));</script>
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
        document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0 }));
        return;
      }
    }
    throw new Error("not found " + text);
  }, [text, nth]);
  await tab.waitForTimeout(50);
}

const box = () => tab.locator('[data-margink-ui="comment-box"]');
const mod = process.platform === "darwin" ? "Meta" : "Control";

// Typing while text is selected opens the composer with the typed text in it.
async function startComment(text, nth = 0, first = "x") {
  await select(text, nth);
  await tab.keyboard.type(first);
  await tab.locator('[data-margink-ui="comment-box"]').waitFor({ timeout: 5000 });
  assert.equal(await tab.locator('[data-margink-ui="comment-box"] textarea').inputValue(), first);
}

const visibleBoxes = () => tab.evaluate(() => [...document.querySelectorAll('[data-margink-ui="comment-box"]')].filter((h) => !h.hasAttribute("data-armed")).length);

// 0. Selecting alone shows nothing new, copying still copies the passage,
//    and navigation keys hand the selection back to the page.
await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: "https://github.com" });
await select("Old words");
assert.equal(await visibleBoxes(), 0, "the composer stays invisible until typing");
await tab.keyboard.press(`${mod}+c`);
assert.equal(await tab.evaluate(() => navigator.clipboard.readText()), "Old words");
await tab.keyboard.press("ArrowDown");
assert.equal(await tab.locator('[data-margink-ui="comment-box"]').count(), 0, "a navigation key disarms");
assert.equal(await tab.evaluate(() => getSelection().toString()), "Old words", "the selection is restored");

// 1. Removed text is commented on the base version.
await startComment("Old words", 0, "W");
assert.deepEqual(await tab.evaluate(() => window.pageShortcuts.filter((k) => k === "W")), [], "GitHub's shortcuts do not see the first key");
await assert.doesNotReject(box().locator(".where", { hasText: "line 3 (before the change)" }).waitFor({ timeout: 5000 }));
await box().locator("textarea").fill("Why remove this?");
// Repeated confirmation while posting starts only one request.
await box().locator("textarea").press(`${mod}+Enter`);
await box().locator("textarea").press(`${mod}+Enter`).catch(() => {});
await tab.locator('[data-margink-ui="posted-comment"]').first().waitFor({ timeout: 5000 });
assert.equal(posts.length, 1);
assert.equal(posts[0].side, "left");
assert.equal(posts[0].line, 3);
assert.equal(posts[0].positioning.commitOid, base);
assert.equal(posts[0].text, "> Old words\n\nWhy remove this?");
assert.equal(await box().count(), 0, "the composer becomes the posted comment");
assert.match(await tab.locator('[data-margink-ui="posted-comment"] .text').innerText(), /Why remove this\?/);

// 2. The second "Repeat me." maps to head line 7.
await startComment("Repeat me.", 1);
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

// 5. Escape discards the composer, and an empty composer closes on an outside click.
await box().locator("textarea").press("Escape");
assert.equal(await box().count(), 0);
await startComment("pnpm");
await box().locator("textarea").fill("");
await tab.mouse.click(5, 5);
assert.equal(await box().count(), 0);

// 6. The composer opens directly beneath the line holding the selection,
//    splitting the paragraph instead of waiting for its end.
await startComment("pnpm", 0, "k");
await box().locator(".where", { hasText: "line 9 (after the change)" }).waitFor({ timeout: 5000 });
const split = await tab.evaluate(() => {
  const host = document.querySelector('[data-margink-ui="comment-box"]');
  const p = host.closest("p");
  return { inParagraph: !!p, after: host.nextSibling?.textContent?.trim().slice(0, 12) ?? "" };
});
assert.ok(split.inParagraph, "composer sits inside the paragraph");
assert.ok(split.after.length > 0, "text continues after the composer");
await box().locator("textarea").fill("");

// 7. IME input starts in the composer from the first key: the composition
//    goes into the text area that already has focus.
await box().locator("textarea").press("Escape");
await select("pnpm");
const cdp = await context.newCDPSession(tab);
await cdp.send("Input.imeSetComposition", { text: "n", selectionStart: 1, selectionEnd: 1 });
await cdp.send("Input.imeSetComposition", { text: "にほんご", selectionStart: 4, selectionEnd: 4 });
await cdp.send("Input.insertText", { text: "日本語" });
assert.equal(await box().locator("textarea").inputValue(), "日本語", "no raw letter is left before the composition");
assert.equal(await visibleBoxes(), 1);

// 8. Hovering a block shows the add button in the margin; clicking it opens
//    a visible composer for the whole block, and the comment has no quote.
await box().locator("textarea").press("Escape");
const addButton = tab.locator('[data-margink-ui="add-button"] button');
const longParagraph = tab.locator("p", { hasText: "Use the Node version" });
await longParagraph.hover();
await addButton.waitFor({ state: "visible", timeout: 2000 });
const buttonBox = await addButton.boundingBox();
const paragraphBox = await longParagraph.boundingBox();
assert.ok(buttonBox.x + buttonBox.width <= paragraphBox.x, "the button sits left of the text");
assert.ok(Math.abs(buttonBox.y - paragraphBox.y) < 12, "the button is level with the first line");
await addButton.click();
assert.equal(await visibleBoxes(), 1, "the composer is shown at once");
await assert.doesNotReject(box().locator(".where", { hasText: "lines 9–10 (after the change)" }).waitFor({ timeout: 5000 }));
assert.equal(await tab.evaluate(() => document.activeElement?.getAttribute("data-margink-ui")), "comment-box", "the composer has focus");
const postsBefore = posts.length;
await tab.keyboard.type("Whole paragraph");
await tab.keyboard.press(`${mod}+Enter`);
await tab.locator('[data-margink-ui="posted-comment"]', { hasText: "Whole paragraph" }).waitFor({ timeout: 5000 });
assert.equal(posts.length, postsBefore + 1);
const blockPost = posts.at(-1);
assert.equal(blockPost.text, "Whole paragraph");
assert.equal(blockPost.startLine, 9);
assert.equal(blockPost.line, 10);

await tab.locator("p", { hasText: "Keep this." }).hover();
await addButton.click();
await assert.doesNotReject(box().locator(".where", { hasText: "line 3 (after the change)" }).waitFor({ timeout: 5000 }));
await box().locator("textarea").fill("こういう感じで");
await tab.locator("p", { hasText: "Repeat me." }).first().hover();
await addButton.waitFor({ state: "visible", timeout: 2000 });

await tab.screenshot({ path: process.env.SCREENSHOT ?? join(tmpdir(), "margink-e2e.png") });
if (process.env.SCREENSHOT_DARK) {
  await tab.emulateMedia({ colorScheme: "dark" });
  await tab.addStyleTag({ content: "@media (prefers-color-scheme: dark) { body { background: #1a1c1f; color: #dde0e4; } }" });
  await tab.screenshot({ path: process.env.SCREENSHOT_DARK });
}
await context.close();
console.log("e2e: all checks passed");
