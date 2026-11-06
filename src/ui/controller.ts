import { buildCommentBody, isBlankComment } from "../lib/comment-body";
import { buildSourceIndex, type SourceIndex } from "../lib/normalize";
import { anchorBlock, renderedSide, SELECTORS, sideOfRange } from "../lib/rendered";
import { RESOLVE_MESSAGES, resolveSelection } from "../lib/resolve";
import { DEFAULT_CHORD, isMacPlatform } from "../lib/shortcut";
import { loadComparison, sha256Hex, type Comparison, type FetchLike } from "../github/comparison";
import { publishComment, type LineTarget } from "../github/publish";
import { parsePullUrl, pullPath, type PullRef } from "../github/pull";
import { loadSourceLines } from "../github/source";
import { CommentBox, UI_ATTRIBUTE } from "./comment-box";

const HIGHLIGHT = "margink-selection";

const PAGE_STYLE = `
::highlight(${HIGHLIGHT}) { background-color: rgba(212, 167, 44, .4); }
[${UI_ATTRIBUTE}="marker"] { all: initial; display: inline-block; margin: 2px 0 8px; cursor: pointer; font: 12px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: var(--fgColor-accent, #0969da); }
[${UI_ATTRIBUTE}="trigger"] { all: initial; position: fixed; z-index: 2147483000; padding: 2px 10px; border-radius: 6px; cursor: pointer; font: 600 12px/1.8 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #fff; background: #1f883d; box-shadow: 0 1px 3px rgba(0,0,0,.3); }
`;

interface Draft {
  pull: PullRef;
  box: CommentBox;
  range: Range;
  selectedText: string;
  target: LineTarget | null;
  comparison: Comparison | null;
  anchor: Element;
}

/** Wires selection, resolution, the comment box, and publication together. */
export class Controller {
  private trigger: HTMLButtonElement | null = null;
  private draft: Draft | null = null;
  private comparison: { key: string; value: Promise<Comparison> } | null = null;
  private readonly sources = new Map<string, Promise<SourceIndex>>();
  private readonly mac: boolean;

  constructor(
    private readonly doc: Document,
    private readonly fetchFn: FetchLike,
  ) {
    this.mac = isMacPlatform(doc.defaultView?.navigator.platform ?? "");
  }

  start(): void {
    const style = this.doc.createElement("style");
    style.setAttribute(UI_ATTRIBUTE, "style");
    style.textContent = PAGE_STYLE;
    this.doc.head.append(style);
    this.doc.addEventListener("mouseup", () => setTimeout(() => this.onSelectionMaybeChanged(), 0));
    this.doc.addEventListener("keyup", (e) => {
      if (e.shiftKey) this.onSelectionMaybeChanged();
    });
    this.doc.addEventListener("selectionchange", () => {
      const sel = this.doc.getSelection();
      if (!sel || sel.isCollapsed) this.hideTrigger();
    });
  }

  /** The rendered file root for a selection, or null if it is not commentable. */
  private selectionRoot(range: Range): Element | null {
    const start = elementOf(range.startContainer)?.closest(SELECTORS.proseRoot);
    const end = elementOf(range.endContainer)?.closest(SELECTORS.proseRoot);
    if (!start || start !== end) return null; // Outside a rendered file, or across files.
    if (elementOf(range.commonAncestorContainer)?.closest(`[${UI_ATTRIBUTE}]`)) return null;
    return start;
  }

  private onSelectionMaybeChanged(): void {
    const sel = this.doc.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0 || !sel.toString().trim()) {
      this.hideTrigger();
      return;
    }
    if (!parsePullUrl(this.doc.location.href)) return;
    const range = sel.getRangeAt(0);
    const root = this.selectionRoot(range);
    if (!root) {
      this.hideTrigger();
      return;
    }
    this.showTrigger(range);
  }

  private showTrigger(range: Range): void {
    if (!this.trigger) {
      const button = this.doc.createElement("button");
      button.type = "button";
      button.setAttribute(UI_ATTRIBUTE, "trigger");
      button.textContent = "Comment";
      // Keep the selection when the button is pressed.
      button.addEventListener("mousedown", (e) => e.preventDefault());
      button.addEventListener("click", () => {
        const sel = this.doc.getSelection();
        if (sel && sel.rangeCount > 0) void this.openDraft(sel.getRangeAt(0).cloneRange());
        this.hideTrigger();
      });
      this.trigger = button;
    }
    const rects = range.getClientRects();
    const last = rects[rects.length - 1] ?? range.getBoundingClientRect();
    this.trigger.style.left = `${Math.max(4, last.right + 4)}px`;
    this.trigger.style.top = `${Math.max(4, last.bottom + 4)}px`;
    if (!this.trigger.isConnected) this.doc.body.append(this.trigger);
  }

  private hideTrigger(): void {
    this.trigger?.remove();
  }

  /** Open the comment box for a selection, keeping any text from an earlier draft. */
  async openDraft(range: Range): Promise<void> {
    const pull = parsePullUrl(this.doc.location.href);
    const root = this.selectionRoot(range);
    if (!pull || !root) return;

    const previousBody = this.draft?.box.body ?? "";
    this.closeDraft();

    const box = new CommentBox(this.doc, {
      chord: DEFAULT_CHORD,
      mac: this.mac,
      modeLabel: "Post to GitHub · published immediately",
      onConfirm: (body) => void this.confirm(body),
      onCancel: () => this.closeDraft(),
    });
    box.body = previousBody;
    const anchor = anchorBlock(range, root);
    anchor.after(box.host);
    const draft: Draft = { pull, box, range, selectedText: range.toString(), target: null, comparison: null, anchor };
    this.draft = draft;
    this.highlight(range);
    box.focus();

    try {
      const side = sideOfRange(range, root);
      if (side === "mixed") {
        box.setUnavailable(RESOLVE_MESSAGES["mixed-versions"]);
        return;
      }
      const comparison = await this.loadComparison(pull);
      const path = await findFilePath(root, comparison);
      if (!path) {
        box.setUnavailable("Margink could not tell which file this text belongs to.");
        return;
      }
      const oid = side === "base" ? comparison.baseOid : comparison.headOid;
      const source = await this.loadSource(pull, oid, path);
      const rendered = renderedSide(range, root, side);
      const result = resolveSelection(rendered.text, rendered.start, rendered.end, source);
      if (this.draft !== draft) return;
      if (!result.ok) {
        box.setUnavailable(RESOLVE_MESSAGES[result.reason]);
        return;
      }
      draft.comparison = comparison;
      draft.target = { path, side, startLine: result.startLine, endLine: result.endLine };
      box.setTarget(describeTarget(draft.target));
    } catch (error) {
      if (this.draft === draft) box.setUnavailable(error instanceof Error ? error.message : String(error));
    }
  }

  private async confirm(body: string): Promise<void> {
    const draft = this.draft;
    if (!draft) return;
    const { box, target, comparison } = draft;
    if (isBlankComment(body)) {
      box.showStatus("Write a comment first.", "error");
      return;
    }
    if (!target || !comparison) return;
    if (!draft.anchor.isConnected) {
      box.showStatus("The page changed since you selected the text. Select it again.", "error");
      return;
    }

    box.setBusy(true);
    box.showStatus("Posting to GitHub…", "info");
    const result = await publishComment(draft.pull, comparison, target, buildCommentBody(draft.selectedText, body), this.fetchFn);
    box.setBusy(false);

    if (result.state === "published") {
      this.closeDraft();
      this.addMarker(draft.anchor, target, result.url ?? `${pullPath(draft.pull)}/files`);
      return;
    }
    if (result.state === "unknown") {
      box.showStatus(result.reason, "error", { href: `${pullPath(draft.pull)}/files`, text: "Open the pull request" });
      return;
    }
    box.showStatus(result.reason, "error");
  }

  private addMarker(anchor: Element, target: LineTarget, href: string): void {
    const marker = this.doc.createElement("a");
    marker.setAttribute(UI_ATTRIBUTE, "marker");
    marker.href = href;
    marker.target = "_blank";
    marker.rel = "noopener";
    marker.textContent = `💬 Comment posted on ${describeTarget(target)} · open on GitHub`;
    anchor.after(marker);
  }

  private closeDraft(): void {
    this.draft?.box.host.remove();
    this.draft = null;
    this.clearHighlight();
  }

  private highlight(range: Range): void {
    const highlights = (globalThis as { CSS?: { highlights?: Map<string, unknown> } }).CSS?.highlights;
    const HighlightCtor = (globalThis as { Highlight?: new (...r: Range[]) => unknown }).Highlight;
    if (highlights && HighlightCtor) highlights.set(HIGHLIGHT, new HighlightCtor(range));
  }

  private clearHighlight(): void {
    (globalThis as { CSS?: { highlights?: Map<string, unknown> } }).CSS?.highlights?.delete(HIGHLIGHT);
  }

  private loadComparison(pull: PullRef): Promise<Comparison> {
    const key = pullPath(pull);
    if (this.comparison?.key !== key) {
      const value = loadComparison(pull, this.doc, this.fetchFn);
      value.catch(() => {
        if (this.comparison?.value === value) this.comparison = null;
      });
      this.comparison = { key, value };
    }
    return this.comparison.value;
  }

  private loadSource(pull: PullRef, oid: string, path: string): Promise<SourceIndex> {
    const key = `${pullPath(pull)}@${oid}:${path}`;
    let value = this.sources.get(key);
    if (!value) {
      value = loadSourceLines(pull, oid, path, this.fetchFn).then(buildSourceIndex);
      value.catch(() => this.sources.delete(key));
      this.sources.set(key, value);
    }
    return value;
  }
}

function elementOf(node: Node): Element | null {
  return node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
}

export function describeTarget(target: LineTarget): string {
  const version = target.side === "base" ? "before the change" : "after the change";
  const lines = target.startLine === target.endLine ? `line ${target.startLine}` : `lines ${target.startLine}–${target.endLine}`;
  return `${target.path} · ${lines} (${version})`;
}

/** Find the changed file a rendered root belongs to. */
export async function findFilePath(root: Element, comparison: Comparison): Promise<string | null> {
  for (let el: Element | null = root; el; el = el.parentElement) {
    const attr = el.getAttribute("data-tagsearch-path") ?? el.getAttribute("data-path") ?? el.getAttribute("data-file-path");
    if (attr) return attr;
    if (el.id.startsWith("diff-")) {
      const digest = el.id.slice("diff-".length);
      const known = comparison.pathsByDigest.get(digest);
      if (known) return known;
      for (const path of comparison.pathsByDigest.values()) {
        if ((await sha256Hex(path)) === digest) return path;
      }
    }
  }
  return null;
}

