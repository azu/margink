// End-to-end check of the built Chrome extension against a stand-in GitHub page.
// With MARGINK_TARGET=userscript, the same checks run against the userscript
// build instead, injected the way a manager runs it once the page has loaded.
// Network requests to github.com are answered locally, so no account is used.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const extension = resolve(".output/chrome-mv3");
const userscript = process.env.MARGINK_TARGET === "userscript";
const base = "a".repeat(40);
const head = "b".repeat(40);
const source = {
  [base]: "# Guide\n\nKeep this. Old words here.\n\nRepeat me.\n",
  [head]: "# Guide\n\nKeep this. New words here.\n\nRepeat me.\n\nRepeat me.\n\nUse the Node version in the version file and pnpm from the package manager field.\nCI reads the version file through the setup action, and local checks do not replace CI.\n",
};

const page = `<!doctype html><html><head><title>PR</title><meta name="user-login" content="octocat"></head><body style="font-family: sans-serif; max-width: 520px; margin: 24px; font-size: 16px; line-height: 1.6">
<div id="diff-0f00">
  <div class="prose-diff"><article class="markdown-body" style="padding: 0 32px">
    <h1>Guide</h1>
    <p>Keep this. <del>Old words here.</del><ins>New words here.</ins></p>
    <p>Repeat me.</p>
    <p><ins>Repeat me.</ins></p>
    <p><ins>Use the Node version in the version file and pnpm from the package manager field. CI reads the version file through the setup action, and local checks do not replace CI.</ins></p>
  </article></div>
<div id="diff-c0de" class="file" data-tagsearch-path="src/app.js" style="margin-top: 24px"><table class="diff-table" style="font-family: monospace; border-collapse: collapse; width: 100%"><tbody>
    <tr><td id="diff-c0deL1" data-line-number="1" class="blob-num blob-num-context"></td><td id="diff-c0deR1" data-line-number="1" class="blob-num blob-num-context js-blob-rnum"></td><td class="blob-code blob-code-context"><button type="button" class="add-line-comment">+</button><span class="blob-code-inner">const a = 1;</span></td></tr>
    <tr><td id="diff-c0deL2" data-line-number="2" class="blob-num blob-num-deletion"></td><td class="blob-num blob-num-deletion empty-cell"></td><td class="blob-code blob-code-deletion"><span class="blob-code-inner">const b = 2;</span></td></tr>
    <tr><td class="blob-num blob-num-addition empty-cell"></td><td id="diff-c0deR2" data-line-number="2" class="blob-num blob-num-addition js-blob-rnum"></td><td class="blob-code blob-code-addition"><span class="blob-code-inner">const b = 3;</span></td></tr>
    <tr><td id="diff-c0deL3" data-line-number="3" class="blob-num blob-num-context"></td><td id="diff-c0deR3" data-line-number="3" class="blob-num blob-num-context js-blob-rnum"></td><td class="blob-code blob-code-context"><span class="blob-code-inner">export { a, b };</span></td></tr>
  </tbody></table></div>
<div role="region" id="diff-1f39" style="margin-top: 24px"><table role="grid" data-diff-anchor="diff-1f39" style="font-family: monospace; border-collapse: collapse; width: 100%"><tbody>
    <tr class="diff-line-row"><td class="focusable-grid-cell new-diff-line-number" data-diff-side="left" data-line-number="100" role="gridcell" tabindex="-1">100</td><td class="focusable-grid-cell new-diff-line-number" data-diff-side="right" data-line-number="100" role="gridcell" tabindex="-1">100</td><td class="diff-text-cell focusable-grid-cell" data-line-anchor="diff-1f39R100" data-diff-side="right" data-line-number="100" role="gridcell" tabindex="-1"><code class="diff-text"><div class="diff-text-inner">let ctx = 0;</div></code></td></tr>
    <tr class="diff-line-row"><td class="focusable-grid-cell new-diff-line-number" data-diff-side="left" data-line-number="101" role="gridcell" tabindex="-1">101</td><td class="focusable-grid-cell new-diff-line-number" data-diff-side="right" role="gridcell" tabindex="-1"></td><td class="diff-text-cell focusable-grid-cell" data-line-anchor="diff-1f39L101" data-diff-side="left" data-line-number="101" role="gridcell" tabindex="-1"><code class="diff-text"><div class="diff-text-inner">let old = 1;</div></code></td></tr>
    <tr class="diff-line-row"><td class="focusable-grid-cell new-diff-line-number" data-diff-side="left" role="gridcell" tabindex="-1"></td><td class="focusable-grid-cell new-diff-line-number" data-diff-side="right" data-line-number="101" role="gridcell" tabindex="-1">101</td><td class="diff-text-cell focusable-grid-cell" data-line-anchor="diff-1f39R101" data-diff-side="right" data-line-number="101" role="gridcell" tabindex="-1"><code class="diff-text"><div class="diff-text-inner">let fresh = 2;</div></code></td></tr>
  </tbody></table></div>
  <div style="height: 2000px"></div>
</div>
<script>window.pageShortcuts = []; document.addEventListener("keydown", (e) => window.pageShortcuts.push(e.key));</script>
</body></html>`;

const posts = [];
const edits = [];
const deletes = [];
const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), "margink-")), {
  channel: "chromium",
  headless: true,
  args: userscript ? [] : [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
});
if (userscript) {
  const code = readFileSync(resolve(".output/margink.user.js"), "utf8");
  await context.addInitScript({ content: `document.addEventListener("DOMContentLoaded", () => {\n${code}\n});` });
}
await context.route("https://github.com/**", async (route) => {
  const req = route.request();
  const url = new URL(req.url());
  if (url.pathname === "/o/r/pull/1/files") return route.fulfill({ contentType: "text/html", body: page });
  if (url.pathname === "/o/r/pull/1/changes") {
    return route.fulfill({ json: { payload: { comparison: { fullDiff: { baseOid: base, headOid: head } }, diffSummaries: [{ path: "docs/guide.md", pathDigest: "0f00" }, { path: "src/new.js", pathDigest: "1f39" }] } } });
  }
  const raw = /^\/o\/r\/raw\/([0-9a-f]+)\/docs\/guide\.md$/.exec(url.pathname);
  if (raw) return route.fulfill({ contentType: "text/plain", body: source[raw[1]] });
  if (url.pathname === "/o/r/pull/1/page_data/create_review_comment" && req.method() === "POST") {
    posts.push(JSON.parse(req.postData()));
    await new Promise((r) => setTimeout(r, 300));
    return route.fulfill({ json: { thread: { commentsData: { comments: [{ databaseId: posts.length, bodyVersion: "v1", url: `https://github.com/o/r/pull/1#discussion_r${posts.length}` }] } } } });
  }
  if (url.pathname === "/o/r/pull/1/page_data/update_review_comment" && req.method() === "PUT") {
    edits.push({ query: url.search, body: JSON.parse(req.postData()) });
    return route.fulfill({ json: { bodyVersion: "v2" } });
  }
  const del = /^\/o\/r\/pull\/1\/page_data\/review_comments\/(\d+)$/.exec(url.pathname);
  if (del && req.method() === "DELETE") {
    deletes.push(del[1]);
    return route.fulfill({ status: 204, body: "" });
  }
  return route.fulfill({ status: 404, body: "" });
});

const tab = await context.newPage();
await tab.goto("https://github.com/o/r/pull/1/files");
await tab.waitForTimeout(500);

async function select(text, nth = 0, within = ".prose-diff") {
  await tab.evaluate(([text, nth, within]) => {
    const walker = document.createTreeWalker(document.querySelector(within), NodeFilter.SHOW_TEXT);
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
  }, [text, nth, within]);
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

// 0b. A word selected by double-clicking can be copied: the second click
//     does not replace its composer with one for the whole block.
async function wordPoint(text) {
  return tab.evaluate((text) => {
    const walker = document.createTreeWalker(document.querySelector(".prose-diff"), NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const at = n.data.indexOf(text);
      if (at < 0) continue;
      const r = document.createRange();
      r.setStart(n, at);
      r.setEnd(n, at + text.length);
      const b = r.getBoundingClientRect();
      return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
    }
    throw new Error("not found " + text);
  }, text);
}
await tab.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
await tab.waitForTimeout(100);
const word = await wordPoint("pnpm");
await tab.evaluate(() => navigator.clipboard.writeText(""));
await tab.mouse.click(word.x, word.y);
await tab.waitForTimeout(150);
await tab.mouse.click(word.x, word.y, { clickCount: 2 });
await tab.waitForTimeout(50);
await tab.keyboard.press(`${mod}+c`);
assert.equal(await tab.evaluate(() => navigator.clipboard.readText()), "pnpm", "a double-clicked word is copied");

// 0c. A right-click hands the selection back, so the context menu can copy it.
const old = await wordPoint("Old words");
await tab.mouse.move(old.x, old.y);
await select("Old words");
await tab.mouse.down({ button: "right" });
assert.equal(await tab.evaluate(() => getSelection().toString()), "Old words", "the selection is restored for the context menu");
await tab.mouse.up({ button: "right" });
await tab.keyboard.press("Escape");
await tab.mouse.click(5, 5);

// 1. Removed text is commented on the base version.
await startComment("Old words", 0, "W");
assert.deepEqual(await tab.evaluate(() => window.pageShortcuts.filter((k) => k === "W")), [], "GitHub's shortcuts do not see the first key");
await assert.doesNotReject(box().locator(".where", { hasText: "guide.md L3 (before)" }).waitFor({ timeout: 5000 }));
await box().locator("textarea").fill("Why remove this?");
// Repeated confirmation while posting starts only one request.
await box().locator("textarea").press(`${mod}+Shift+Enter`);
await box().locator("textarea").press(`${mod}+Shift+Enter`).catch(() => {});
await tab.locator('[data-margink-ui="posted-comment"]').first().waitFor({ timeout: 5000 });
assert.equal(posts.length, 1);
assert.equal(posts[0].side, "left");
assert.equal(posts[0].line, 3);
assert.equal(posts[0].positioning.commitOid, base);
assert.equal(posts[0].text, "> Old words\n\nWhy remove this?");
assert.equal(await box().count(), 0, "the composer becomes the posted comment");
assert.match(await tab.locator('[data-margink-ui="posted-comment"] .text').inputValue(), /Why remove this\?/);

// 1b. The posted comment is edited in place: put the cursor in it, type, and
//     confirm to save. Escape undoes an unsaved edit.
const postedText = tab.locator('[data-margink-ui="posted-comment"] .text').first();
await postedText.click();
await tab.keyboard.press("End");
await tab.keyboard.type(" Typo");
await tab.keyboard.press("Escape");
assert.equal(await postedText.inputValue(), "Why remove this?", "Escape undoes the edit");
await postedText.click();
await tab.keyboard.press("End");
await tab.keyboard.type(" It is still used.");
assert.equal(edits.length, 0);
await tab.keyboard.press(`${mod}+Enter`);
await tab.waitForFunction(() => document.querySelector('[data-margink-ui="posted-comment"]')?.shadowRoot?.querySelector(".card")?.hasAttribute("data-editing") === false);
assert.equal(edits.length, 1);
assert.deepEqual(edits[0], { query: "?body_version=v1", body: { body: "> Old words\n\nWhy remove this? It is still used.", commentId: "1" } });
assert.equal(posts.length, 1, "editing does not post a new comment");

// 2. The second "Repeat me." maps to head line 7.
await startComment("Repeat me.", 1);
await box().locator(".where", { hasText: /guide\.md L7$/ }).waitFor({ timeout: 5000 });

// 3. A blank comment is not posted and the box stays.
await box().locator("textarea").fill("   ");
await box().locator(".publish").click({ force: true });
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
await box().locator(".where", { hasText: /guide\.md L9$/ }).waitFor({ timeout: 5000 });
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
assert.ok(paragraphBox.x - (buttonBox.x + buttonBox.width) <= 10, "the button sits right beside the text");
assert.ok(Math.abs(buttonBox.y - paragraphBox.y) < 12, "the button is level with the first line");
await addButton.click();
assert.equal(await visibleBoxes(), 1, "the composer is shown at once");
await assert.doesNotReject(box().locator(".where", { hasText: /guide\.md L9–10$/ }).waitFor({ timeout: 5000 }));
assert.equal(await tab.evaluate(() => document.activeElement?.getAttribute("data-margink-ui")), "comment-box", "the composer has focus");
const postsBefore = posts.length;
await tab.keyboard.type("Whole paragraph");
await tab.keyboard.press(`${mod}+Shift+Enter`);
await tab.locator('[data-margink-ui="posted-comment"]', { hasText: "Whole paragraph" }).waitFor({ timeout: 5000 });
assert.equal(posts.length, postsBefore + 1);
const blockPost = posts.at(-1);
assert.equal(blockPost.text, "Whole paragraph");
assert.equal(blockPost.startLine, 9);
assert.equal(blockPost.line, 10);

await tab.locator("p", { hasText: "Keep this." }).hover();
await addButton.click();
await assert.doesNotReject(box().locator(".where", { hasText: /guide\.md L3$/ }).waitFor({ timeout: 5000 }));
await box().locator("textarea").fill("");
await box().locator("textarea").press("Escape");

// 9. Without a selection, clicking in a block and typing starts a comment
//    on that block; a click alone changes nothing on screen, and Space
//    still scrolls the page.
const heading = tab.locator("h1");
const textTop = () => longParagraph.evaluate((p) => p.getBoundingClientRect().top + scrollY);
const headingY = await textTop();
await heading.click();
await tab.waitForTimeout(50);
assert.equal(await visibleBoxes(), 0, "a click alone shows nothing");
assert.equal(await textTop(), headingY, "a click alone does not move the text");
await tab.keyboard.type("Typed");
assert.equal(await visibleBoxes(), 1);
assert.equal(await box().locator("textarea").inputValue(), "Typed");
await assert.doesNotReject(box().locator(".where", { hasText: /guide\.md L1$/ }).waitFor({ timeout: 5000 }));
await box().locator("textarea").fill("");
await box().locator("textarea").press("Escape");
await longParagraph.click();
await tab.waitForTimeout(50);
assert.equal(await tab.locator('[data-margink-ui="comment-box"][data-armed]').count(), 1);
await tab.keyboard.press(" ");
await tab.waitForTimeout(300);
assert.equal(await tab.locator('[data-margink-ui="comment-box"]').count(), 0, "Space hands the page back");
assert.ok(await tab.evaluate(() => scrollY) > 0, "Space scrolls the page");
await tab.evaluate(() => scrollTo(0, 0));

// 10. The confirm chord adds the comment to the pending review, as in
//     GitHub's diff comment box; every other check publishes with Shift.
await heading.click();
await tab.waitForTimeout(50);
await tab.keyboard.type("Pending note");
await assert.doesNotReject(box().locator(".where", { hasText: /guide\.md L1$/ }).waitFor({ timeout: 5000 }));
assert.match(await box().locator(".review").innerText(), /^Review /);
const beforeReview = posts.length;
await tab.keyboard.press(`${mod}+Enter`);
await tab.locator('[data-margink-ui="posted-comment"]', { hasText: "Pending note" }).waitFor({ timeout: 5000 });
assert.equal(posts.length, beforeReview + 1);
assert.equal(posts.at(-1).submitBatch, false, "the comment stays in the pending review");
assert.equal(posts.at(-1).text, "Pending note");
assert.match(await tab.locator('[data-margink-ui="posted-comment"]', { hasText: "Pending note" }).locator(".where").innerText(), /^Pending review · guide\.md L1$/);
assert.equal(posts.filter((p) => p.submitBatch === true).length, beforeReview, "earlier comments were published immediately");

// 11. Source diffs work the same way: select part of a line and type.
await select("b = 3", 0, ".diff-table");
assert.equal(await visibleBoxes(), 0);
await tab.keyboard.type("Why 3?");
await assert.doesNotReject(box().locator(".where", { hasText: /app\.js L2$/ }).waitFor({ timeout: 5000 }));
await tab.keyboard.press(`${mod}+Shift+Enter`);
await tab.locator('[data-margink-ui="posted-comment"]', { hasText: "Why 3?" }).waitFor({ timeout: 5000 });
assert.deepEqual(
  { path: posts.at(-1).path, line: posts.at(-1).line, side: posts.at(-1).side, text: posts.at(-1).text },
  { path: "src/app.js", line: 2, side: "right", text: "> b = 3\n\nWhy 3?" },
);
assert.equal(await tab.locator('[data-margink-ui="code-row"]').count(), 1, "the comment stays in its own table row");

//     A click on a removed line and typing comments on that base line;
//     the click alone does not move the code.
const exportRow = tab.locator("tr", { hasText: "export" });
const rowTop = () => exportRow.evaluate((r) => r.getBoundingClientRect().top + scrollY);
const exportTop = await rowTop();
await tab.locator(".blob-code-inner", { hasText: "const b = 2;" }).click();
await tab.waitForTimeout(50);
assert.equal(await rowTop(), exportTop, "a click alone does not move the code");
await tab.keyboard.type("Gone");
await assert.doesNotReject(box().locator(".where", { hasText: "app.js L2 (before)" }).waitFor({ timeout: 5000 }));
await box().locator("textarea").fill("");
await box().locator("textarea").press("Escape");
assert.equal(await tab.locator('[data-margink-ui="code-row"]').count(), 1, "cancelling removes the composer row");

//     GitHub's own "+" on a line is left alone.
await tab.locator("button.add-line-comment").click();
await tab.waitForTimeout(50);
assert.equal(await tab.locator('[data-margink-ui="comment-box"]').count(), 0);

//     The React "Files changed" view (markup from a signed-in /changes page).
await select("fresh", 0, "#diff-1f39");
await tab.keyboard.type("Why fresh?");
await assert.doesNotReject(box().locator(".where", { hasText: /new\.js L101$/ }).waitFor({ timeout: 5000 }));
await tab.keyboard.press(`${mod}+Shift+Enter`);
await tab.locator('[data-margink-ui="posted-comment"]', { hasText: "Why fresh?" }).waitFor({ timeout: 5000 });
assert.deepEqual(
  { path: posts.at(-1).path, line: posts.at(-1).line, side: posts.at(-1).side, text: posts.at(-1).text },
  { path: "src/new.js", line: 101, side: "right", text: "> fresh\n\nWhy fresh?" },
);
await tab.locator(".diff-text-inner", { hasText: "let old = 1;" }).click();
await tab.waitForTimeout(50);
await tab.keyboard.type("Old");
await assert.doesNotReject(box().locator(".where", { hasText: "new.js L101 (before)" }).waitFor({ timeout: 5000 }));
await box().locator("textarea").fill("");
await box().locator("textarea").press("Escape");

// 12. Several composers can be open at once: starting another comment keeps
//     the ones that already hold text.
await select("Keep this.");
await tab.keyboard.type("First draft");
await select("Repeat me.", 0);
await tab.keyboard.type("Second draft");
assert.equal(await visibleBoxes(), 2, "both composers stay open");
const firstBox = box().filter({ has: tab.locator("textarea") }).nth(0);
assert.deepEqual(await box().locator("textarea").evaluateAll((t) => t.map((x) => x.value)), ["First draft", "Second draft"]);
//     Each composer posts its own comment.
const beforeMulti = posts.length;
await box().nth(1).locator("textarea").press(`${mod}+Shift+Enter`);
await tab.locator('[data-margink-ui="posted-comment"]', { hasText: "Second draft" }).waitFor({ timeout: 5000 });
assert.equal(posts.length, beforeMulti + 1);
assert.match(posts.at(-1).text, /Second draft$/);
assert.equal(await box().locator("textarea").inputValue(), "First draft", "the other composer keeps its text");
//     A posted comment can be deleted after confirming.
const second = tab.locator('[data-margink-ui="posted-comment"]', { hasText: "Second draft" });
const secondId = String(posts.length);
tab.once("dialog", (dialog) => dialog.dismiss());
await second.locator(".delete").click();
assert.equal(deletes.length, 0, "dismissing the confirmation keeps the comment");
tab.once("dialog", (dialog) => dialog.accept());
await second.locator(".delete").click();
await second.waitFor({ state: "detached", timeout: 5000 });
assert.deepEqual(deletes, [secondId]);
//     An empty composer still gives way to the next one.
await box().locator("textarea").fill("");
await select("pnpm");
assert.equal(await tab.locator('[data-margink-ui="comment-box"]').count(), 1, "the emptied composer closed");
await tab.keyboard.type("こういう感じで");
await tab.locator("p", { hasText: "Repeat me." }).first().hover();
await addButton.waitFor({ state: "visible", timeout: 2000 });

if (process.env.SCREENSHOT_CODE) await tab.locator("#diff-c0de").screenshot({ path: process.env.SCREENSHOT_CODE });
await tab.screenshot({ path: process.env.SCREENSHOT ?? join(tmpdir(), "margink-e2e.png") });
if (process.env.SCREENSHOT_DARK) {
  await tab.emulateMedia({ colorScheme: "dark" });
  await tab.addStyleTag({ content: "@media (prefers-color-scheme: dark) { body { background: #1a1c1f; color: #dde0e4; } }" });
  await tab.screenshot({ path: process.env.SCREENSHOT_DARK });
}
await context.close();
console.log(`e2e (${userscript ? "userscript" : "extension"}): all checks passed`);
