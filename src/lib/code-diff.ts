import type { ResolveFailure, Side } from "./resolve";

/**
 * Selectors for GitHub's source ("code") diff table, in both unified and
 * split views. They describe page markup GitHub can change, so they live here.
 */
export const CODE_SELECTORS = {
  table: "table.diff-table",
  code: "td.blob-code",
  number: "td.blob-num",
  removed: "blob-code-deletion",
  hunk: "blob-code-hunk",
} as const;

export interface CodeLine {
  side: Side;
  line: number;
  row: HTMLTableRowElement;
}

/** The diff table holding `node`, or null when it is not in a source diff. */
export function codeTableOf(node: Node): Element | null {
  const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  return el?.closest(CODE_SELECTORS.table) ?? null;
}

/**
 * The source line shown by one code cell. In the split view each code cell
 * follows its own line-number cell. In the unified view a row has both
 * numbers; removed lines use the left (base) number and every other line
 * the right (head) number, as GitHub does for its own comments.
 */
export function codeLineOfCell(cell: Element): CodeLine | null {
  if (!cell.matches(CODE_SELECTORS.code) || cell.classList.contains(CODE_SELECTORS.hunk)) return null;
  const row = cell.closest("tr");
  if (!row) return null;
  const before = cell.previousElementSibling;
  const numbers = [...row.querySelectorAll<HTMLElement>(`:scope > ${CODE_SELECTORS.number}`)];
  const codeCells = row.querySelectorAll(`:scope > ${CODE_SELECTORS.code}`).length;
  let number: Element | null;
  if (codeCells > 1) {
    number = before?.matches(CODE_SELECTORS.number) ? before : null;
  } else {
    const removed = cell.classList.contains(CODE_SELECTORS.removed);
    number = (removed ? numbers.find((n) => sideOfNumber(n) === "base") : numbers.find((n) => sideOfNumber(n) === "head")) ?? null;
  }
  const line = Number(number?.getAttribute("data-line-number"));
  const side = number ? sideOfNumber(number) : null;
  if (!side || !Number.isInteger(line) || line < 1) return null;
  return { side, line, row: row as HTMLTableRowElement };
}

function sideOfNumber(number: Element): Side | null {
  const id = number.id;
  if (/L\d+$/.test(id)) return "base";
  if (/R\d+$/.test(id)) return "head";
  // Without an id, the right-hand number cell carries js-blob-rnum.
  if (!number.getAttribute("data-line-number")) return null;
  return number.classList.contains("js-blob-rnum") ? "head" : "base";
}

export type CodeResolveResult =
  | { ok: true; side: Side; startLine: number; endLine: number; endRow: HTMLTableRowElement }
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
    const el = range.startContainer.nodeType === Node.ELEMENT_NODE ? (range.startContainer as Element) : range.startContainer.parentElement;
    const cell = el?.closest(CODE_SELECTORS.code);
    const line = cell ? codeLineOfCell(cell) : null;
    if (line) lines.push(line);
  } else {
    const doc = table.ownerDocument;
    for (const cell of table.querySelectorAll(CODE_SELECTORS.code)) {
      if (!range.intersectsNode(cell)) continue;
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
 * Insert a table row for the composer after `row`, spanning the whole
 * table width the way GitHub's own inline comment rows do. While
 * `collapsed` is set, the row takes no height, so preparing a hidden
 * composer never moves the code.
 */
export function insertCodeRow(row: HTMLTableRowElement, host: Element, uiAttribute: string): HTMLTableRowElement {
  const doc = row.ownerDocument;
  const tr = doc.createElement("tr");
  tr.setAttribute(uiAttribute, "code-row");
  const td = doc.createElement("td");
  const columns = [...row.children].reduce((n, c) => n + ((c as HTMLTableCellElement).colSpan || 1), 0);
  td.colSpan = Math.max(columns, 1);
  td.append(host);
  tr.append(td);
  setCodeRowCollapsed(tr, true);
  row.after(tr);
  return tr;
}

export function setCodeRowCollapsed(tr: HTMLTableRowElement, collapsed: boolean): void {
  const td = tr.firstElementChild as HTMLElement | null;
  if (!td) return;
  td.style.cssText = collapsed
    ? "padding: 0; border: 0; height: 0; line-height: 0; font-size: 0;"
    : "padding: 8px 16px; border-top: 1px solid var(--borderColor-muted, #d1d9e0b3); border-bottom: 1px solid var(--borderColor-muted, #d1d9e0b3); white-space: normal;";
}
