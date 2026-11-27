// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderMarkdown, resolveRepoUrl } from "../src/lib/markdown";
import { buildSourceIndex } from "../src/lib/normalize";
import { renderedSide, sideOfRange, SELECTORS } from "../src/lib/rendered";
import { resolveSelection } from "../src/lib/resolve";
import { findUnsupportedNotices, RenderFallback } from "../src/ui/render-fallback";

const location = { owner: "o", repo: "r", oid: "a".repeat(40), path: "docs/guide.md" };

function rangeOver(root: Element, text: string): Range {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const at = (n as Text).data.indexOf(text);
    if (at >= 0) {
      const r = document.createRange();
      r.setStart(n, at);
      r.setEnd(n, at + text.length);
      return r;
    }
  }
  throw new Error(`text not found: ${text}`);
}

describe("renderMarkdown", () => {
  it("renders GitHub Flavored Markdown", () => {
    const div = document.createElement("div");
    div.append(renderMarkdown("# Title\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n- [x] done\n- ~~old~~", location, document));
    expect(div.querySelector("h1")?.textContent).toBe("Title");
    expect(div.querySelectorAll("td")).toHaveLength(2);
    const box = div.querySelector<HTMLInputElement>("li input");
    expect(box?.type).toBe("checkbox");
    expect(box?.checked).toBe(true);
    expect(box?.disabled).toBe(true);
    expect(div.querySelector("del")).not.toBeNull();
  });

  it("removes active content from raw HTML", () => {
    const div = document.createElement("div");
    div.append(renderMarkdown('<img src="x.png" onerror="alert(1)"><script>alert(2)</script><a href="javascript:alert(3)">x</a><input type="text"><details><summary>More</summary>Body</details>', location, document));
    expect(div.innerHTML).not.toMatch(/onerror|<script|javascript:|type="text"/);
    expect(div.querySelector("details summary")?.textContent).toBe("More");
  });

  it("points relative links and images at the same commit", () => {
    const div = document.createElement("div");
    div.append(renderMarkdown("[a](other.md#x) ![i](../img/p.png) [root](/README.md) [ext](https://example.com/) [h](#top)", location, document));
    const hrefs = [...div.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual([`/o/r/blob/${location.oid}/docs/other.md#x`, `/o/r/blob/${location.oid}/README.md`, "https://example.com/", "#top"]);
    expect(div.querySelector("img")?.getAttribute("src")).toBe(`/o/r/raw/${location.oid}/img/p.png`);
  });

  it("does not resolve a relative URL above the repository root", () => {
    expect(resolveRepoUrl("../../../x", location, "blob")).toBeNull();
  });

  it("renders text that resolves to its source lines", () => {
    const source = ["# Guide", "", "Install the **tool** first.", "", "- Run it", "- Read the [docs](docs.md)"];
    document.body.innerHTML = `<div data-margink-rendered="head"><article class="markdown-body"></article></div>`;
    const root = document.querySelector(SELECTORS.proseRoot)!;
    root.firstElementChild!.append(renderMarkdown(source.join("\n"), location, document));
    const range = rangeOver(root, "Read the ");
    range.setEnd(root.querySelector("a")!.firstChild!, 4);
    expect(sideOfRange(range, root)).toBe("head");
    const rendered = renderedSide(range, root, "head");
    expect(resolveSelection(rendered.text, rendered.start, rendered.end, buildSourceIndex(source))).toEqual({ ok: true, startLine: 6, endLine: 6 });
  });
});

describe("RenderFallback", () => {
  it("adds one button per unsupported notice and renders the file below it", async () => {
    document.body.innerHTML = `<div id="diff-abc"><div class="notice">This rich diff is not supported at the moment.</div></div>`;
    const fallback = new RenderFallback(document, async () => renderMarkdown("Hello **world**", location, document), () => true);
    fallback.scan();
    fallback.scan();
    const buttons = document.querySelectorAll("[data-margink-ui] button");
    expect(buttons).toHaveLength(1);
    expect(findUnsupportedNotices(document)).toHaveLength(0);
    (buttons[0] as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r, 0));
    const view = document.querySelector<HTMLElement>("[data-margink-rendered]")!;
    expect(view.querySelector("strong")?.textContent).toBe("world");
    expect(view.closest(SELECTORS.proseRoot)).toBe(view);
    (buttons[0] as HTMLButtonElement).click();
    expect(view.hidden).toBe(true);
  });

  it("shows the reason when the file cannot be rendered", async () => {
    document.body.innerHTML = `<p>This rich diff is not supported at the moment.</p>`;
    const fallback = new RenderFallback(document, async () => {
      throw new Error("Margink renders only Markdown files.");
    }, () => true);
    fallback.scan();
    document.querySelector<HTMLButtonElement>("[data-margink-ui] button")!.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(document.querySelector("[role=status]")?.textContent).toBe("Margink renders only Markdown files.");
    expect(document.querySelector("[data-margink-rendered]")).toBeNull();
  });

  it("does nothing outside a pull request", () => {
    document.body.innerHTML = `<p>This rich diff is not supported at the moment.</p>`;
    new RenderFallback(document, async () => document.createDocumentFragment(), () => false).scan();
    expect(document.querySelector("[data-margink-ui]")).toBeNull();
  });
});
