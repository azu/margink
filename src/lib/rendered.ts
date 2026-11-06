import { normalizeText } from "./normalize";
import type { Side } from "./resolve";

/**
 * Selectors for GitHub's rendered prose diff.
 * They describe page markup that GitHub can change, so they live in one place.
 */
export const SELECTORS = {
  /** The rendered Markdown of one file. */
  proseRoot: ".prose-diff, .rich-diff",
  /** Text that exists only in the base version. */
  removed: "del, .removed",
  /** Text that exists only in the head version. */
  added: "ins, .added",
  /** Content without selectable source text. */
  skipped: "svg, img, iframe, script, style, math, [data-margink-ui]",
} as const;

function closestOrSelf(node: Node, selector: string, root: Element): Element | null {
  const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  const found = el?.closest(selector) ?? null;
  return found && root.contains(found) ? found : null;
}

export function isRemoved(node: Node, root: Element): boolean {
  return closestOrSelf(node, SELECTORS.removed, root) !== null;
}

export function isAdded(node: Node, root: Element): boolean {
  return closestOrSelf(node, SELECTORS.added, root) !== null;
}

function textNodesInRange(range: Range, root: Element): Text[] {
  const nodes: Text[] = [];
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const text = n as Text;
    if (!text.data.trim()) continue;
    if (range.intersectsNode(text)) nodes.push(text);
  }
  return nodes.filter((t) => !closestOrSelf(t, SELECTORS.skipped, root));
}

/** Decide which version a selection belongs to. */
export function sideOfRange(range: Range, root: Element): Side | "mixed" {
  let removed = false;
  let added = false;
  for (const t of textNodesInRange(range, root)) {
    if (isRemoved(t, root)) removed = true;
    else if (isAdded(t, root)) added = true;
  }
  if (removed && added) return "mixed";
  return removed ? "base" : "head";
}

export interface RenderedSide {
  text: string;
  start: number;
  end: number;
}

/**
 * Build the normalized text of one version of the rendered file and locate
 * the selection inside it. Text belonging to the other version is skipped.
 */
export function renderedSide(range: Range, root: Element, side: Side): RenderedSide {
  let text = "";
  let start = -1;
  let end = -1;
  const doc = root.ownerDocument;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);

  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const node = n as Text;
    if (closestOrSelf(node, SELECTORS.skipped, root)) continue;
    if (side === "head" && isRemoved(node, root)) continue;
    if (side === "base" && isAdded(node, root)) continue;

    const data = node.data;
    if (start < 0) {
      if (node === range.startContainer) start = text.length + normalizedLength(data.slice(0, range.startOffset));
      else if (boundaryAtOrBefore(range.startContainer, range.startOffset, node)) start = text.length;
    }
    if (end < 0) {
      if (node === range.endContainer) end = text.length + normalizedLength(data.slice(0, range.endOffset));
      else if (boundaryAtOrBefore(range.endContainer, range.endOffset, node)) end = text.length;
    }
    text += normalizeText(data);
  }
  if (start < 0) start = text.length;
  if (end < 0) end = text.length;
  return { text, start, end };
}

function normalizedLength(text: string): number {
  return normalizeText(text).length;
}

/** Whether the boundary point (container, offset) is at or before the start of node. */
function boundaryAtOrBefore(container: Node, offset: number, node: Text): boolean {
  const doc = node.ownerDocument;
  const probe = doc.createRange();
  probe.setStart(node, 0);
  const boundary = doc.createRange();
  boundary.setStart(container, offset);
  return boundary.compareBoundaryPoints(Range.START_TO_START, probe) <= 0;
}

/** Block elements a comment box can follow. */
const BLOCKS = "p, li, h1, h2, h3, h4, h5, h6, pre, blockquote, table, dd, dt, details";

/**
 * The element after which the comment box is inserted: the block holding
 * the end of the selection, moved outside GitHub's insertion and deletion
 * wrappers so their styling does not apply to the box.
 */
export function anchorBlock(range: Range, root: Element): Element {
  const end = range.endContainer;
  const el = end.nodeType === Node.ELEMENT_NODE ? (end as Element) : end.parentElement!;
  let block = el.closest(BLOCKS);
  if (!block || !root.contains(block)) block = el;
  return outsideWrappers(block.closest("table") ?? block, root);
}

/** The outermost insertion or deletion wrapper around `block`, or the block itself. */
function outsideWrappers(block: Element, root: Element): Element {
  let outer: Element = block;
  for (let p = block.parentElement; p && p !== root; p = p.parentElement) {
    if (p.matches("ins, del, u, .added, .removed")) outer = p;
  }
  return outer;
}

/**
 * Rendered blocks that the add button comments on as a whole, the rendered
 * counterpart of a line in GitHub's source diff. Paragraphs inside list
 * items and quotes are their own blocks, and a table row is one block.
 */
export const LINE_BLOCKS = "p, h1, h2, h3, h4, h5, h6, li, pre, tr, dt, dd";

/** The commentable block under `el`, or null. */
export function lineBlockAt(el: Element, root: Element): Element | null {
  const block = el.closest(LINE_BLOCKS);
  if (!block || !root.contains(block) || block.closest(SELECTORS.skipped)) return null;
  return blockRange(block).toString().trim() ? block : null;
}

/** The text of a block, without the nested lists of a list item. */
export function blockRange(block: Element): Range {
  const range = block.ownerDocument.createRange();
  range.selectNodeContents(block);
  if (block.tagName === "LI") {
    const nested = block.querySelector(":scope > ul, :scope > ol");
    if (nested) range.setEndBefore(nested);
  }
  return range;
}

/**
 * The version a whole block is commented on: the base version when all of
 * its text was removed, otherwise the head version. In a paragraph with
 * both removed and added words, the removed words are left out.
 */
export function sideOfBlock(range: Range, root: Element): Side {
  const nodes = textNodesInRange(range, root);
  return nodes.length > 0 && nodes.every((t) => isRemoved(t, root)) ? "base" : "head";
}

/**
 * Insert `host` right after a block commented on as a whole: inside a list
 * item before its nested list, after the table for a table row, and outside
 * insertion and deletion wrappers otherwise.
 */
export function insertAfterBlock(block: Element, root: Element, host: Element): void {
  if (block.tagName === "LI") {
    const nested = block.querySelector(":scope > ul, :scope > ol");
    if (nested) nested.before(host);
    else block.append(host);
    return;
  }
  outsideWrappers(block.closest("table") ?? block, root).after(host);
}

/** Blocks whose lines are not split by an inline comment. */
const UNSPLITTABLE = "pre, table, svg, math";

/**
 * Insert `host` directly beneath the rendered line that holds the end of
 * the selection, so the comment sits right under the words it is about.
 *
 * The rendered paragraph is split at the next visual line: the first
 * character that lays out below the selection's last line. When that point
 * is inside inline markup (a link, emphasis, code), the host goes after
 * that whole inline element instead, so it never ends up inside a link.
 * Without layout information, inside code blocks and tables, or on the
 * block's last line, the host goes after the block.
 */
export function insertBeneathLine(range: Range, root: Element, host: Element): void {
  const fallback = () => anchorBlock(range, root).after(host);
  const endEl = range.endContainer.nodeType === Node.ELEMENT_NODE ? (range.endContainer as Element) : range.endContainer.parentElement;
  const block = endEl?.closest(BLOCKS);
  if (!block || !root.contains(block) || block.closest(UNSPLITTABLE)) return fallback();

  const rects = range.getClientRects();
  const last = rects[rects.length - 1];
  if (!last || last.height === 0) return fallback();
  const lineBottom = last.bottom;

  const doc = block.ownerDocument;
  const walker = doc.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  walker.currentNode = range.endContainer;
  let node: Node | null = range.endContainer.nodeType === Node.TEXT_NODE ? range.endContainer : walker.nextNode();
  let from = range.endContainer.nodeType === Node.TEXT_NODE ? range.endOffset : 0;
  const probe = doc.createRange();

  for (; node; node = walker.nextNode(), from = 0) {
    const text = node as Text;
    if (closestOrSelf(text, SELECTORS.skipped, root)) continue;
    for (let i = from; i < text.data.length; i++) {
      if (/\s/.test(text.data[i]!)) continue;
      probe.setStart(text, i);
      probe.setEnd(text, i + 1);
      const r = probe.getBoundingClientRect();
      if (r.height > 0 && r.top >= lineBottom - 1) {
        placeBefore(text, i, block, host);
        return;
      }
    }
  }
  fallback();
}

function placeBefore(text: Text, offset: number, block: Element, host: Element): void {
  // Inline markup other than insertion/deletion wrappers must not contain the host.
  let inline: Element | null = null;
  for (let p = text.parentElement; p && p !== block; p = p.parentElement) {
    if (!p.matches("ins, del, .added, .removed, span")) inline = p;
  }
  if (inline) {
    inline.after(host);
    return;
  }
  const rest = offset > 0 ? text.splitText(offset) : text;
  rest.before(host);
}
