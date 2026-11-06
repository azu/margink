// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { codeLineOfCell, insertCodeRow, resolveCodeRange } from "../src/lib/code-diff";

const D = "diff-abc";
function unified(): Element {
  document.body.innerHTML = `<div id="${D}" class="file" data-tagsearch-path="src/app.js"><table class="diff-table"><tbody>
    <tr><td class="blob-num blob-num-hunk" colspan="2"></td><td class="blob-code blob-code-inner blob-code-hunk">@@ -1,3 +1,3 @@</td></tr>
    <tr><td id="${D}L1" data-line-number="1" class="blob-num blob-num-context"></td><td id="${D}R1" data-line-number="1" class="blob-num blob-num-context js-blob-rnum"></td><td class="blob-code blob-code-context"><span class="blob-code-inner">const a = 1;</span></td></tr>
    <tr><td id="${D}L2" data-line-number="2" class="blob-num blob-num-deletion"></td><td class="blob-num blob-num-deletion empty-cell"></td><td class="blob-code blob-code-deletion"><span class="blob-code-inner">const b = 2;</span></td></tr>
    <tr><td class="blob-num blob-num-addition empty-cell"></td><td id="${D}R2" data-line-number="2" class="blob-num blob-num-addition js-blob-rnum"></td><td class="blob-code blob-code-addition"><span class="blob-code-inner">const b = 3;</span></td></tr>
    <tr><td id="${D}L3" data-line-number="3" class="blob-num blob-num-context"></td><td id="${D}R3" data-line-number="3" class="blob-num blob-num-context js-blob-rnum"></td><td class="blob-code blob-code-context"><span class="blob-code-inner">export { a, b };</span></td></tr>
  </tbody></table></div>`;
  return document.querySelector("table")!;
}

function split(): Element {
  document.body.innerHTML = `<div id="${D}" class="file"><table class="diff-table"><tbody>
    <tr><td id="${D}L2" data-line-number="2" class="blob-num blob-num-deletion"></td><td class="blob-code blob-code-deletion"><span class="blob-code-inner">const b = 2;</span></td>
        <td id="${D}R2" data-line-number="2" class="blob-num blob-num-addition"></td><td class="blob-code blob-code-addition"><span class="blob-code-inner">const b = 3;</span></td></tr>
  </tbody></table></div>`;
  return document.querySelector("table")!;
}

function textOf(table: Element, text: string, nth = 0): Text {
  const nodes = [...table.querySelectorAll(".blob-code-inner")].map((s) => s.firstChild as Text).filter((t) => t?.data.includes(text));
  return nodes[nth]!;
}

describe("source diff lines", () => {
  it("uses the head number for context and added lines and the base number for removed lines", () => {
    const t = unified();
    const cells = [...t.querySelectorAll("td.blob-code")];
    expect(codeLineOfCell(cells[0]!)).toBeNull(); // hunk header
    expect(codeLineOfCell(cells[1]!)).toMatchObject({ side: "head", line: 1 });
    expect(codeLineOfCell(cells[2]!)).toMatchObject({ side: "base", line: 2 });
    expect(codeLineOfCell(cells[3]!)).toMatchObject({ side: "head", line: 2 });
  });

  it("uses each cell's own number in the split view", () => {
    const t = split();
    const [left, right] = [...t.querySelectorAll("td.blob-code")];
    expect(codeLineOfCell(left!)).toMatchObject({ side: "base", line: 2 });
    expect(codeLineOfCell(right!)).toMatchObject({ side: "head", line: 2 });
  });

  it("resolves a selection across head lines and ignores a line it only touches", () => {
    const t = unified();
    const r = document.createRange();
    r.setStart(textOf(t, "const b = 3"), 6);
    // Ends at the very start of the next line, as a triple click does.
    r.setEnd(textOf(t, "export"), 0);
    expect(resolveCodeRange(r)).toMatchObject({ ok: true, side: "head", startLine: 2, endLine: 2 });
    r.setStart(textOf(t, "const a"), 0);
    r.setEnd(textOf(t, "export"), 6);
    expect(resolveCodeRange(r)).toMatchObject({ ok: false, reason: "mixed-versions" });
  });

  it("resolves a caret to its line", () => {
    const t = unified();
    const r = document.createRange();
    r.setStart(textOf(t, "const b = 2"), 3);
    expect(resolveCodeRange(r)).toMatchObject({ ok: true, side: "base", startLine: 2, endLine: 2 });
  });

  it("adds a full-width row for the composer", () => {
    const t = unified();
    const row = t.querySelectorAll("tr")[1] as HTMLTableRowElement;
    const host = document.createElement("div");
    const tr = insertCodeRow(row, host, "data-margink-ui");
    expect(row.nextElementSibling).toBe(tr);
    expect((tr.firstElementChild as HTMLTableCellElement).colSpan).toBe(3);
  });
});
