import { describe, expect, it } from "vitest";
import { buildSourceIndex, normalizeText } from "../src/lib/normalize";
import { resolveSelection } from "../src/lib/resolve";

const source = [
  "# Guide", // 1
  "", // 2
  "This is **bold** and a [link](https://example.com).", // 3
  "", // 4
  "- First item", // 5
  "- Second item", // 6
  "", // 7
  "| Name | Value |", // 8
  "| --- | --- |", // 9
  "| alpha | one |", // 10
  "", // 11
  "```mermaid", // 12
  "graph TD; A-->B", // 13
  "```", // 14
  "", // 15
  "Repeat me.", // 16
  "", // 17
  "Repeat me.", // 18
  "A paragraph that", // 19
  "wraps across lines.", // 20
];

const rendered = normalizeText(
  "Guide This is bold and a link. First item Second item Name Value alpha one Repeat me. Repeat me. A paragraph that wraps across lines.",
);
const index = buildSourceIndex(source);

function select(text: string, occurrence = 0) {
  const needle = normalizeText(text);
  let at = -1;
  for (let i = 0; i <= occurrence; i++) at = rendered.indexOf(needle, at + 1);
  return resolveSelection(rendered, at, at + needle.length, index);
}

describe("resolveSelection", () => {
  it("maps formatted text to its source line", () => {
    expect(select("bold and a link")).toEqual({ ok: true, startLine: 3, endLine: 3 });
  });

  it("maps headings, list items, and table cells", () => {
    expect(select("Guide")).toEqual({ ok: true, startLine: 1, endLine: 1 });
    expect(select("Second item")).toEqual({ ok: true, startLine: 6, endLine: 6 });
    expect(select("alpha one")).toEqual({ ok: true, startLine: 10, endLine: 10 });
  });

  it("returns a range for text that spans source lines", () => {
    expect(select("paragraph that wraps")).toEqual({ ok: true, startLine: 19, endLine: 20 });
  });

  it("tells repeated text apart by its order", () => {
    expect(select("Repeat me.", 0)).toEqual({ ok: true, startLine: 16, endLine: 16 });
    expect(select("Repeat me.", 1)).toEqual({ ok: true, startLine: 18, endLine: 18 });
  });

  it("does not map diagram source", () => {
    const r = normalizeText("graph TD");
    expect(resolveSelection(r, 0, r.length, index)).toEqual({ ok: false, reason: "not-found" });
  });

  it("refuses when the rendered and source occurrence counts differ", () => {
    const one = normalizeText("Repeat me.");
    expect(resolveSelection(one, 0, one.length, index)).toEqual({ ok: false, reason: "ambiguous" });
  });

  it("refuses an empty selection", () => {
    expect(resolveSelection(rendered, 3, 3, index)).toEqual({ ok: false, reason: "empty-selection" });
  });
});

describe("buildSourceIndex", () => {
  it("skips front matter and keeps code blocks literally", () => {
    const idx = buildSourceIndex(["---", "title: x", "---", "```js", "const a_b = 1;", "```"]);
    expect(idx.text).toBe(normalizeText("const a_b = 1;"));
    expect(new Set(idx.lineOf)).toEqual(new Set([5]));
  });
});
