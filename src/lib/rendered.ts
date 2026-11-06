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
  if (block.tagName === "TD" || block.tagName === "TH" || block.closest("table")) {
    block = block.closest("table") ?? block;
  }
  let outer: Element = block;
  for (let p = block.parentElement; p && p !== root; p = p.parentElement) {
    if (p.matches("ins, del, u, .added, .removed")) outer = p;
  }
  return outer;
}
