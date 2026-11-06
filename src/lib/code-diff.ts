import type { ResolveFailure, Side } from "./resolve";

/**
 * GitHub's source ("code") diffs come in two markups: the classic table
 * (`table.diff-table`, line numbers in `td.blob-num[data-line-number]`) and
 * the React "Files changed" view, whose cells carry `data-line-number`,
 * `data-diff-side` ("left"/"right"), and `data-line-anchor`. Both are read
 * the same way: a code cell's line number is in the number cells just
 * before it in its row. They describe page markup GitHub can change.
 */
export const CODE_SELECTORS = {
  table: "table, [role=grid], [role=table]",
  row: "tr, [role=row]",
  cell: "td, th, [role=gridcell], [role=cell]",
  number: "[data-line-number]",
  /** Line-number cells (classic, then the React view). */
  numberCell: ".blob-num, .new-diff-line-number",
  hunk: "blob-code-hunk",
} as const;

export interface CodeLine {
  side: Side;
  line: number;
  row: HTMLElement;
}

function elementOf(node: Node): Element | null {
  return node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
}

/** The diff table holding `node`, or null when it is not in a source diff. */
export function codeTableOf(node: Node): Element | null {
  const table = elementOf(node)?.closest(CODE_SELECTORS.table);
  return table && table.querySelector(CODE_SELECTORS.number) ? table : null;
}

/** The code cell holding `node`, or null for line numbers and other cells. */
export function codeCellOf(node: Node): Element | null {
  const cell = elementOf(node)?.closest(CODE_SELECTORS.cell);
  if (!cell || cell.matches(CODE_SELECTORS.numberCell) || !codeTableOf(cell)) return null;
  return cell;
}

/**
 * The source line shown by one code cell. The number cells right before it
 * hold one number in the split view and two (left, then right) in the
 * unified view; the last one with a number applies. So in the unified
 * view a context or added line uses its right (head) number and a removed
 * line, whose right number is empty, its left (base) number, as GitHub
 * does for its own comments.
 */
export function codeLineOfCell(cell: Element): CodeLine | null {
  if (cell.classList.contains(CODE_SELECTORS.hunk)) return null;
  const row = cell.closest(CODE_SELECTORS.row) as HTMLElement | null;
  if (!row) return null;
  // The React view puts the line and side on the code cell itself
  // (td.diff-text-cell[data-line-number][data-diff-side]).
  const ownLine = lineNumberOf(cell);
  const ownSide = cell.getAttribute("data-diff-side");
  if (ownLine !== null && (ownSide === "left" || ownSide === "right")) {
    return { side: ownSide === "left" ? "base" : "head", line: ownLine, row };
  }
  let chosen: Element | null = null;
  for (let prev = cell.previousElementSibling; prev; prev = prev.previousElementSibling) {
    const isNumber = prev.matches(CODE_SELECTORS.numberCell) || prev.hasAttribute("data-line-number");
    // Another code cell (the other side of a split row) ends the group.
    if (!isNumber && prev.textContent?.trim()) break;
    if (!isNumber) continue;
    if (lineNumberOf(prev) !== null) {
      chosen = prev;
      break;
    }
  }
  const line = chosen ? lineNumberOf(chosen) : null;
  const side = chosen ? sideOfNumber(chosen) : null;
  if (!side || line === null) return null;
  return { side, line, row };
}

function lineNumberOf(cell: Element): number | null {
  const line = Number(cell.getAttribute("data-line-number"));
  return cell.getAttribute("data-line-number") && Number.isInteger(line) && line > 0 ? line : null;
}

function sideOfNumber(number: Element): Side | null {
  // The React view's data-diff-side is reliable; its anchors can name the
  // other side in aligned split rows.
  const side = number.getAttribute("data-diff-side");
  if (side === "left") return "base";
  if (side === "right") return "head";
  const anchor = number.id || number.getAttribute("data-line-anchor") || "";
  if (/L\d+$/.test(anchor)) return "base";
  if (/R\d+$/.test(anchor)) return "head";
  return number.classList.contains("js-blob-rnum") ? "head" : null;
}

export type CodeResolveResult =
  | { ok: true; side: Side; startLine: number; endLine: number; endRow: HTMLElement }
  | { ok: false; reason: ResolveFailure };

/**
 * Map a selection (or a collapsed caret) in a diff table to a line range.
 * Only cells whose own text is selected count, so a selection that ends at
 * the very start of the next line does not include that line.
 */
export function resolveCodeRange(range: Range): CodeResolveResult {
  const table = codeTableOf(range.startContainer);
  if (!table || table !== codeTableOf(range.endContainer)) return { ok: false, reason: "not-found" };

  const lines: CodeLine[] = [];
  if (range.collapsed) {
    const cell = codeCellOf(range.startContainer);
    const line = cell ? codeLineOfCell(cell) : null;
    if (line) lines.push(line);
  } else {
    const doc = table.ownerDocument;
    for (const cell of table.querySelectorAll(CODE_SELECTORS.cell)) {
      if (cell.matches(CODE_SELECTORS.numberCell) || !range.intersectsNode(cell)) continue;
      const own = doc.createRange();
      own.selectNodeContents(cell);
      if (range.compareBoundaryPoints(Range.START_TO_START, own) > 0) own.setStart(range.startContainer, range.startOffset);
      if (range.compareBoundaryPoints(Range.END_TO_END, own) < 0) own.setEnd(range.endContainer, range.endOffset);
      if (!own.toString().trim()) continue;
      const line = codeLineOfCell(cell);
      if (line) lines.push(line);
    }
  }
  if (lines.length === 0) return { ok: false, reason: "empty-selection" };
  const side = lines[0]!.side;
  if (lines.some((l) => l.side !== side)) return { ok: false, reason: "mixed-versions" };
  const numbers = lines.map((l) => l.line);
  return {
    ok: true,
    side,
    startLine: Math.min(...numbers),
    endLine: Math.max(...numbers),
    endRow: lines[lines.length - 1]!.row,
  };
}

/**
 * Insert a row for the composer after `row`, spanning the whole table
 * width the way GitHub's own inline comment rows do. While `collapsed` is
 * set, the row takes no height, so preparing a hidden composer never moves
 * the code.
 */
export function insertCodeRow(row: HTMLElement, host: Element, uiAttribute: string): HTMLElement {
  const doc = row.ownerDocument;
  let outer: HTMLElement;
  let inner: HTMLElement;
  if (row.tagName === "TR") {
    outer = doc.createElement("tr");
    const td = doc.createElement("td");
    const columns = [...row.children].reduce((n, c) => n + ((c as HTMLTableCellElement).colSpan || 1), 0);
    td.colSpan = Math.max(columns, 1);
    outer.append(td);
    inner = td;
  } else {
    // A row of a div-based grid: span every column of the grid.
    outer = doc.createElement("div");
    outer.style.gridColumn = "1 / -1";
    inner = doc.createElement("div");
    outer.append(inner);
  }
  outer.setAttribute(uiAttribute, "code-row");
  inner.append(host);
  setCodeRowCollapsed(outer, true);
  row.after(outer);
  return outer;
}

export function setCodeRowCollapsed(outer: HTMLElement, collapsed: boolean): void {
  const inner = outer.firstElementChild as HTMLElement | null;
  if (!inner) return;
  inner.style.cssText = collapsed
    ? "padding: 0; border: 0; height: 0; line-height: 0; font-size: 0;"
    : "padding: 8px 16px; border-top: 1px solid var(--borderColor-muted, #d1d9e0b3); border-bottom: 1px solid var(--borderColor-muted, #d1d9e0b3); white-space: normal; font-size: 14px; line-height: 1.5;";
}
