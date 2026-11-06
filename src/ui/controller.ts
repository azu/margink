import { buildCommentBody, isBlankComment } from "../lib/comment-body";
import { codeCellOf, codeTableOf, insertCodeRow, resolveCodeRange, setCodeRowCollapsed } from "../lib/code-diff";
import { buildSourceIndex, type SourceIndex } from "../lib/normalize";
import { blockRange, insertAfterBlock, insertBeneathLine, lineBlockAt, renderedSide, SELECTORS, sideOfBlock, sideOfRange } from "../lib/rendered";
import { RESOLVE_MESSAGES, resolveSelection } from "../lib/resolve";
import { DEFAULT_CHORD, isMacPlatform } from "../lib/shortcut";
import { loadComparison, sha256Hex, type Comparison, type FetchLike } from "../github/comparison";
import { deleteComment, publishComment, updateComment, type Delivery, type LineTarget, type PostedComment } from "../github/publish";
import { parsePullUrl, pullPath, type PullRef } from "../github/pull";
import { loadSourceLines } from "../github/source";
import { AddButton } from "./add-button";
import { CommentBox, UI_ATTRIBUTE } from "./comment-box";

/** Elements whose click does something of its own, so it never starts a comment. */
// tabindex="-1" only makes an element focusable by script, as GitHub's diff grid cells are.
const INTERACTIVE = "a, button, summary, label, input, select, textarea, [contenteditable], [role=button], [tabindex]:not([tabindex='-1'])";

const ARMED_HIGHLIGHT = "margink-armed";
const DRAFT_HIGHLIGHT = "margink-draft";
const POSTED_HIGHLIGHT = "margink-posted";

const PAGE_STYLE = `
::highlight(${ARMED_HIGHLIGHT}) { background-color: rgba(84, 174, 255, .35); }
::highlight(${DRAFT_HIGHLIGHT}) { text-decoration: underline 2px #8250df; text-underline-offset: 4px; }
::highlight(${POSTED_HIGHLIGHT}) { text-decoration: underline 2px rgba(130, 80, 223, .55); text-underline-offset: 4px; }
@media (prefers-color-scheme: dark) {
  ::highlight(${DRAFT_HIGHLIGHT}) { text-decoration-color: #ab7aca; }
  ::highlight(${POSTED_HIGHLIGHT}) { text-decoration-color: rgba(171, 122, 202, .55); }
}
`;

interface Draft {
  pull: PullRef;
  box: CommentBox;
  range: Range;
  /** The selected words, quoted in the published comment; empty for a whole block. */
  quote: string;
  /** Whether the comment is on a whole block from the add button. */
  wholeBlock: boolean;
  /** For a comment on a source diff, the table row that holds the composer. */
  codeRow: HTMLElement | null;
  target: LineTarget | null;
  comparison: Comparison | null;
  root: Element;
  /** The element the composer was inserted into, merged back on cancel. */
  parent: Node | null;
}

/** Wires selection, resolution, the comment box, and publication together. */
export class Controller {
  private readonly posted: Range[] = [];
  /** Every open composer, so several comments can be written at once. */
  private readonly drafts = new Set<Draft>();
  /** The composer opened last; only it can be hidden (armed) or blank. */
  private draft: Draft | null = null;
  private comparison: { key: string; value: Promise<Comparison> } | null = null;
  private readonly sources = new Map<string, Promise<SourceIndex>>();
  private readonly mac: boolean;
  private readonly addButton: AddButton;

  constructor(
    private readonly doc: Document,
    private readonly fetchFn: FetchLike,
  ) {
    this.mac = isMacPlatform(doc.defaultView?.navigator.platform ?? "");
    this.addButton = new AddButton(doc, (block, root) => this.startBlockDraft(block, root));
  }

  start(): void {
    const style = this.doc.createElement("style");
    style.setAttribute(UI_ATTRIBUTE, "style");
    style.textContent = PAGE_STYLE;
    this.doc.head.append(style);
    // When a selection is finished, an invisible composer takes focus, so the
    // next key types into it (through the IME when one is active) instead of
    // reaching GitHub's single-key shortcuts.
    this.doc.addEventListener("mouseup", (e) => {
      if (e.button !== 0 || isMarginkUi(e.target)) return;
      const target = e.target;
      setTimeout(() => this.onSelectionFinished(target), 0);
    });
    this.doc.addEventListener("keyup", (e) => {
      if (e.key === "Shift") this.onSelectionFinished();
    });
    // An empty composer is dismissed by clicking elsewhere, like a popover.
    // Composers that hold text stay open, so several comments can be drafted.
    this.doc.addEventListener("mousedown", (e) => {
      for (const draft of [...this.drafts]) {
        if (!isBlankComment(draft.box.body)) continue;
        if (e.target instanceof Node && draft.box.host.contains(e.target)) continue;
        this.closeDraft(draft);
      }
    });
    // Hovering a rendered block shows the add button beside it, as GitHub
    // shows "+" beside a hovered line in a source diff.
    this.doc.addEventListener("mousemove", (e) => this.onHover(e.target), { passive: true });
    this.doc.defaultView?.addEventListener("resize", () => this.addButton.reposition(), { passive: true });
  }

  private onHover(target: EventTarget | null): void {
    if (!(target instanceof Node)) return;
    if (this.addButton.host.contains(target)) return this.addButton.keep();
    const el = elementOf(target);
    const root = el?.closest(SELECTORS.proseRoot);
    if (!el || !root || isMarginkUi(el) || !parsePullUrl(this.doc.location.href)) return this.addButton.hideSoon();
    const block = lineBlockAt(el, root);
    // Between blocks, such as in the margin on the way to the button, it stays.
    if (!block) return;
    if (block === this.addButton.target) return this.addButton.keep();
    this.addButton.show(block, root);
  }

  /** The rendered file root for a selection, or null if it is not commentable. */
  private selectionRoot(range: Range): Element | null {
    const start = elementOf(range.startContainer)?.closest(SELECTORS.proseRoot);
    const end = elementOf(range.endContainer)?.closest(SELECTORS.proseRoot);
    if (!start || start !== end) return null; // Outside a rendered file, or across files.
    if (elementOf(range.commonAncestorContainer)?.closest(`[${UI_ATTRIBUTE}]`)) return null;
    return start;
  }

  /** The source diff table for a selection, or null if it is not one. */
  private codeRoot(range: Range): Element | null {
    const table = codeTableOf(range.startContainer);
    if (!table || table !== codeTableOf(range.endContainer)) return null;
    if (elementOf(range.commonAncestorContainer)?.closest(`[${UI_ATTRIBUTE}]`)) return null;
    return table;
  }

  private onSelectionFinished(clicked?: EventTarget | null): void {
    const sel = this.doc.getSelection();
    if (!sel || !parsePullUrl(this.doc.location.href)) return;
    if (sel.isCollapsed || !sel.toString().trim()) {
      if (clicked) this.onClick(clicked);
      return;
    }
    const range = sel.getRangeAt(0);
    if (this.selectionRoot(range)) this.armDraft(range.cloneRange());
    else if (this.codeRoot(range)) this.armCodeDraft(range.cloneRange(), false);
  }

  /**
   * A click without a selection in a rendered block prepares an invisible
   * composer for the whole block, so typing right away starts a comment there.
   */
  private onClick(target: EventTarget): void {
    if (!(target instanceof Node)) return;
    const el = elementOf(target);
    if (!el || el.closest(INTERACTIVE) || isMarginkUi(el)) return;
    // In a source diff, a click on a line works like GitHub's "+" on that line.
    const cell = codeCellOf(el);
    if (cell) {
      const caret = this.doc.getSelection();
      if (caret && caret.rangeCount > 0 && cell.contains(caret.getRangeAt(0).startContainer)) {
        this.armCodeDraft(caret.getRangeAt(0).cloneRange(), true);
      }
      return;
    }
    const root = el.closest(SELECTORS.proseRoot);
    const block = root ? lineBlockAt(el, root) : null;
    if (!root || !block) return;
    const draft = this.openDraft(blockRange(block), root, true);
    if (!draft) return;
    draft.box.arm();
    insertAfterBlock(block, root, draft.box.host);
    this.focusDraft(draft);
  }

  /** Insert an invisible composer beneath the selection and give it focus. */
  armDraft(range: Range): void {
    const root = this.selectionRoot(range);
    if (!root) return;
    const draft = this.openDraft(range, root, false);
    if (!draft) return;
    draft.box.arm(draft.quote);
    insertBeneathLine(range, root, draft.box.host);
    this.focusDraft(draft);
  }

  /**
   * Prepare a hidden composer in a new table row under the selected source
   * lines (or the clicked line). The row takes no height until typing starts.
   */
  armCodeDraft(range: Range, wholeLine: boolean): void {
    const table = this.codeRoot(range);
    if (!table) return;
    const resolved = resolveCodeRange(range);
    if (!resolved.ok && resolved.reason === "empty-selection") return;
    const endRow = resolved.ok ? resolved.endRow : (elementOf(range.endContainer)?.closest<HTMLElement>("tr, [role=row]") ?? null);
    if (!endRow) return;
    const draft = this.openDraft(range, table, wholeLine);
    if (!draft) return;
    // A part of one line is quoted, so readers see which part is meant;
    // GitHub already shows whole lines above the comment.
    const text = range.toString();
    draft.quote = !wholeLine && resolved.ok && resolved.startLine === resolved.endLine && text.trim() !== (codeCellOf(range.startContainer)?.textContent?.trim() ?? "") ? text : "";
    draft.codeRow = insertCodeRow(endRow, draft.box.host, UI_ATTRIBUTE);
    draft.box.arm(wholeLine ? undefined : text);
    this.focusDraft(draft);
  }

  /** The add button was clicked: comment on the whole block, starting now. */
  startBlockDraft(block: Element, root: Element): void {
    const draft = this.openDraft(blockRange(block), root, true);
    if (!draft) return;
    this.doc.getSelection()?.removeAllRanges();
    insertAfterBlock(block, root, draft.box.host);
    this.focusDraft(draft);
    void this.revealDraft(draft);
  }

  private openDraft(range: Range, root: Element, wholeBlock: boolean): Draft | null {
    const pull = parsePullUrl(this.doc.location.href);
    if (!pull) return null;
    // A blank composer gives way to the new one; composers with text stay.
    for (const open of [...this.drafts]) {
      if (isBlankComment(open.box.body)) this.closeDraft(open);
    }
    const box = new CommentBox(this.doc, {
      chord: DEFAULT_CHORD,
      mac: this.mac,
      destination: "Post to GitHub",
      avatarUrl: viewerAvatarUrl(this.doc),
      onConfirm: (body, delivery) => void this.confirm(draft, body, delivery),
      onCancel: () => this.closeDraft(draft),
      onReveal: () => void this.revealDraft(draft),
      onDisarm: () => this.closeDraft(draft, { restoreSelection: !wholeBlock }),
    });
    const draft: Draft = { pull, box, range, root, quote: wholeBlock ? "" : range.toString(), wholeBlock, codeRow: null, target: null, comparison: null, parent: null };
    this.draft = draft;
    this.drafts.add(draft);
    return draft;
  }

  private focusDraft(draft: Draft): void {
    draft.parent = draft.box.host.parentNode;
    draft.box.focus();
    this.paintHighlights();
  }

  /** The reviewer started typing: show the composer and resolve its target. */
  private async revealDraft(draft: Draft): Promise<void> {
    if (!this.drafts.has(draft)) return;
    this.paintHighlights();
    const { box, range, root, pull } = draft;
    if (draft.codeRow) {
      setCodeRowCollapsed(draft.codeRow, false);
      return this.resolveCodeDraft(draft);
    }
    try {
      const side = draft.wholeBlock ? sideOfBlock(range, root) : sideOfRange(range, root);
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
      if (!this.drafts.has(draft)) return;
      if (!result.ok) {
        box.setUnavailable(RESOLVE_MESSAGES[result.reason]);
        return;
      }
      draft.comparison = comparison;
      draft.target = { path, side, startLine: result.startLine, endLine: result.endLine };
      box.setTarget(shortTarget(draft.target), describeTarget(draft.target));
    } catch (error) {
      if (this.drafts.has(draft)) box.setUnavailable(error instanceof Error ? error.message : String(error));
    }
  }

  private async resolveCodeDraft(draft: Draft): Promise<void> {
    const { box, range, root, pull } = draft;
    const resolved = resolveCodeRange(range);
    if (!resolved.ok) {
      box.setUnavailable(RESOLVE_MESSAGES[resolved.reason]);
      return;
    }
    try {
      const comparison = await this.loadComparison(pull);
      const path = await findFilePath(root, comparison);
      if (!this.drafts.has(draft)) return;
      if (!path) {
        box.setUnavailable("Margink could not tell which file this line belongs to.");
        return;
      }
      draft.comparison = comparison;
      draft.target = { path, side: resolved.side, startLine: resolved.startLine, endLine: resolved.endLine };
      box.setTarget(shortTarget(draft.target), describeTarget(draft.target));
    } catch (error) {
      if (this.drafts.has(draft)) box.setUnavailable(error instanceof Error ? error.message : String(error));
    }
  }

  private async confirm(draft: Draft, body: string, delivery: Delivery): Promise<void> {
    if (!this.drafts.has(draft)) return;
    const { box, target, comparison } = draft;
    if (isBlankComment(body)) {
      box.showStatus("Write a comment first.", "error");
      return;
    }
    if (!target || !comparison) return;
    const stillThere = draft.codeRow ? draft.root.isConnected : this.selectionRoot(draft.range) !== null;
    if (!draft.box.host.isConnected || !stillThere) {
      box.showStatus("The page changed since you selected the text. Select it again.", "error");
      return;
    }

    box.setBusy(true);
    box.showStatus(delivery === "publish" ? "Posting to GitHub…" : "Adding to your review…", "info");
    const result = await publishComment(draft.pull, comparison, target, buildCommentBody(draft.quote, body), this.fetchFn, delivery);
    box.setBusy(false);

    if (result.state === "published") {
      // The composer stays where it is and becomes the finished comment.
      // A pending comment is submitted from GitHub's own review control on the files page.
      const href = delivery === "publish" ? (result.url ?? `${pullPath(draft.pull)}/files`) : `${pullPath(draft.pull)}/files`;
      // Without the new comment's ID, it can only be changed on GitHub.
      const comment = result.comment;
      const actions = comment
        ? { onUpdate: (text: string) => void this.updatePosted(draft, comment, text), onDelete: () => void this.deletePosted(draft, comment) }
        : undefined;
      box.showPosted(body, shortTarget(target), href, delivery, describeTarget(target), actions);
      this.posted.push(draft.range);
      this.drafts.delete(draft);
      if (this.draft === draft) this.draft = null;
      this.paintHighlights();
      return;
    }
    if (result.state === "unknown") {
      box.showStatus(result.reason, "error", { href: `${pullPath(draft.pull)}/files`, text: "Open the pull request" });
      return;
    }
    box.showStatus(result.reason, "error");
  }

  /** Save an edited posted comment, keeping its quotation. */
  private async updatePosted(draft: Draft, comment: PostedComment, text: string): Promise<void> {
    const { box } = draft;
    if (isBlankComment(text)) {
      box.showStatus("Write a comment, or use Delete to remove it.", "error");
      return;
    }
    box.setBusy(true);
    box.showStatus("Saving…", "info");
    const result = await updateComment(draft.pull, comment, buildCommentBody(draft.quote, text), this.fetchFn);
    box.setBusy(false);
    if (result.state === "done") {
      if (result.bodyVersion) comment.bodyVersion = result.bodyVersion;
      box.markSaved(text);
      return;
    }
    box.showStatus(result.reason, "error", result.state === "unknown" ? { href: `${pullPath(draft.pull)}/files`, text: "Open the pull request" } : undefined);
  }

  /** Delete a posted comment on GitHub and remove its card. */
  private async deletePosted(draft: Draft, comment: PostedComment): Promise<void> {
    const { box } = draft;
    const view = this.doc.defaultView;
    if (view && !view.confirm("Delete this comment on GitHub?")) return;
    box.setBusy(true);
    box.showStatus("Deleting…", "info");
    const result = await deleteComment(draft.pull, comment, this.fetchFn);
    box.setBusy(false);
    if (result.state !== "done") {
      box.showStatus(result.reason, "error", result.state === "unknown" ? { href: `${pullPath(draft.pull)}/files`, text: "Open the pull request" } : undefined);
      return;
    }
    if (draft.codeRow) draft.codeRow.remove();
    else box.host.remove();
    draft.parent?.normalize();
    const index = this.posted.indexOf(draft.range);
    if (index >= 0) this.posted.splice(index, 1);
    this.paintHighlights();
  }

  private closeDraft(draft: Draft, options: { restoreSelection?: boolean } = {}): void {
    if (this.draft === draft) this.draft = null;
    if (this.drafts.delete(draft)) {
      if (draft.codeRow) draft.codeRow.remove();
      else draft.box.host.remove();
      draft.parent?.normalize(); // Rejoin the text split for the composer.
      if (options.restoreSelection) {
        const sel = this.doc.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(draft.range);
      }
    }
    this.paintHighlights();
  }

  private paintHighlights(): void {
    const css = (globalThis as { CSS?: { highlights?: Map<string, unknown> } }).CSS;
    const HighlightCtor = (globalThis as { Highlight?: new (...r: Range[]) => unknown }).Highlight;
    if (!css?.highlights || !HighlightCtor) return;
    // While armed, the passage looks selected; once typing starts it is underlined.
    const armed = this.draft?.box.isArmed && !this.draft.wholeBlock ? this.draft.range : null;
    const drafting = [...this.drafts].filter((d) => !d.box.isArmed).map((d) => d.range);
    if (armed) css.highlights.set(ARMED_HIGHLIGHT, new HighlightCtor(armed));
    else css.highlights.delete(ARMED_HIGHLIGHT);
    if (drafting.length > 0) css.highlights.set(DRAFT_HIGHLIGHT, new HighlightCtor(...drafting));
    else css.highlights.delete(DRAFT_HIGHLIGHT);
    css.highlights.set(POSTED_HIGHLIGHT, new HighlightCtor(...this.posted));
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

/** The signed-in viewer's avatar, from the login GitHub puts in the page. */
export function viewerAvatarUrl(doc: Document): string | null {
  const login = doc.querySelector<HTMLMetaElement>('meta[name="user-login"]')?.content;
  return login ? `https://github.com/${encodeURIComponent(login)}.png?size=40` : null;
}

function isMarginkUi(target: EventTarget | null): boolean {
  return target instanceof Node && elementOf(target)?.closest(`[${UI_ATTRIBUTE}]`) != null;
}

function elementOf(node: Node): Element | null {
  return node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
}

export function describeTarget(target: LineTarget): string {
  const version = target.side === "base" ? "before the change" : "after the change";
  const lines = target.startLine === target.endLine ? `line ${target.startLine}` : `lines ${target.startLine}–${target.endLine}`;
  return `${target.path} · ${lines} (${version})`;
}

/** A compact target, such as "guide.md L3" or "guide.md L3–5 (before)". */
export function shortTarget(target: LineTarget): string {
  const name = target.path.slice(target.path.lastIndexOf("/") + 1);
  const lines = target.startLine === target.endLine ? `L${target.startLine}` : `L${target.startLine}–${target.endLine}`;
  return `${name} ${lines}${target.side === "base" ? " (before)" : ""}`;
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

