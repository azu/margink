// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { buildSourceIndex } from "../src/lib/normalize";
import { anchorBlock, renderedSide, sideOfRange } from "../src/lib/rendered";
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
