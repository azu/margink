// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { buildSourceIndex } from "../src/lib/normalize";
import { anchorBlock, blockRange, insertAfterBlock, lineBlockAt, renderedSide, sideOfBlock, sideOfRange } from "../src/lib/rendered";
import { resolveSelection } from "../src/lib/resolve";

function setup(html: string) {
  document.body.innerHTML = `<div class="prose-diff">${html}</div>`;
  return document.querySelector(".prose-diff")!;
}

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

describe("rendered diff", () => {
  const html = `<h1>Title</h1>
    <p>Keep this. <del>Old words here.</del><ins>New words here.</ins></p>
    <p>Same words.</p>`;

  it("assigns removed text to the base version and added text to the head version", () => {
    const root = setup(html);
    expect(sideOfRange(rangeOver(root, "Old words"), root)).toBe("base");
    expect(sideOfRange(rangeOver(root, "New words"), root)).toBe("head");
    expect(sideOfRange(rangeOver(root, "Same words"), root)).toBe("head");
  });

  it("rejects a selection that mixes removed and added text", () => {
    const root = setup(html);
    const r = document.createRange();
    r.setStart(rangeOver(root, "Old").startContainer, 0);
    r.setEnd(rangeOver(root, "New").startContainer, 3);
    expect(sideOfRange(r, root)).toBe("mixed");
  });

  it("resolves removed text against the base source, not similar head text", () => {
    const root = setup(html);
    const base = buildSourceIndex(["# Title", "", "Keep this. Old words here.", "", "Same words."]);
    const range = rangeOver(root, "Old words here.");
    const side = renderedSide(range, root, "base");
    expect(side.text.slice(side.start, side.end)).toBe("Oldwordshere.");
    expect(resolveSelection(side.text, side.start, side.end, base)).toEqual({ ok: true, startLine: 3, endLine: 3 });
  });

  it("leaves the other version's text out of the rendered side", () => {
    const root = setup(html);
    const side = renderedSide(rangeOver(root, "Same"), root, "head");
    expect(side.text).not.toContain("Old");
    expect(side.text).toContain("Newwordshere.");
  });

  it("places the comment box after the block, outside insertion wrappers", () => {
    const root = setup(`<ins><p>Added paragraph.</p></ins><table><tr><td>cell</td></tr></table>`);
    expect(anchorBlock(rangeOver(root, "Added"), root).tagName).toBe("INS");
    expect(anchorBlock(rangeOver(root, "cell"), root).tagName).toBe("TABLE");
  });
});

describe("whole-block comments", () => {
  const source = buildSourceIndex([
    "# Title",
    "",
    "Keep this. New words here.",
    "",
    "- First item",
    "  - Nested item",
    "",
    "| a | b |",
    "| - | - |",
    "| one | two |",
  ]);

  function resolveBlock(root: Element, block: Element) {
    const range = blockRange(block);
    const side = sideOfBlock(range, root);
    const r = renderedSide(range, root, side);
    return { side, ...resolveSelection(r.text, r.start, r.end, source) };
  }

  it("finds the block under the pointer and skips empty ones", () => {
    const root = setup(`<ul><li><p>Para in item.</p></li></ul><p><img alt=""></p>`);
    expect(lineBlockAt(root.querySelector("li p")!, root)?.tagName).toBe("P");
    expect(lineBlockAt(root.querySelector("img")!, root)).toBeNull();
  });

  it("comments on the head words of a changed paragraph", () => {
    const root = setup(`<h1>Title</h1><p>Keep this. <del>Old words here.</del><ins>New words here.</ins></p>`);
    expect(resolveBlock(root, root.querySelector("p")!)).toEqual({ side: "head", ok: true, startLine: 3, endLine: 3 });
  });

  it("uses the base version for a fully removed block", () => {
    const root = setup(`<del><p>Gone.</p></del>`);
    expect(sideOfBlock(blockRange(root.querySelector("p")!), root)).toBe("base");
  });

  it("leaves nested lists out of a list item", () => {
    const root = setup(`<ul><li>First item<ul><li>Nested item</li></ul></li></ul>`);
    const outer = root.querySelector("li")!;
    expect(blockRange(outer).toString()).toBe("First item");
    expect(resolveBlock(root, outer)).toMatchObject({ ok: true, startLine: 5, endLine: 5 });
    expect(resolveBlock(root, outer.querySelector("li")!)).toMatchObject({ ok: true, startLine: 6, endLine: 6 });
  });

  it("maps a table row to its source line", () => {
    const root = setup(`<table><tr><th>a</th><th>b</th></tr><tr><td>one</td><td>two</td></tr></table>`);
    expect(resolveBlock(root, root.querySelectorAll("tr")[1]!)).toMatchObject({ ok: true, startLine: 10, endLine: 10 });
  });

  it("places the composer after the block, before a nested list, or after the table", () => {
    const root = setup(`<ins><p>Added.</p></ins><ul><li>Item<ul><li>Nested</li></ul></li></ul><table><tr><td>c</td></tr></table>`);
    const a = document.createElement("div");
    insertAfterBlock(root.querySelector("p")!, root, a);
    expect(a.previousElementSibling?.tagName).toBe("INS");
    const b = document.createElement("div");
    insertAfterBlock(root.querySelector("li")!, root, b);
    expect(b.nextElementSibling?.tagName).toBe("UL");
    const c = document.createElement("div");
    insertAfterBlock(root.querySelector("tr")!, root, c);
    expect(c.previousElementSibling?.tagName).toBe("TABLE");
  });
});
