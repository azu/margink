import { buildCommentBody, isBlankComment } from "../lib/comment-body";
import { buildSourceIndex, type SourceIndex } from "../lib/normalize";
import { insertBeneathLine, renderedSide, SELECTORS, sideOfRange } from "../lib/rendered";
import { RESOLVE_MESSAGES, resolveSelection } from "../lib/resolve";
import { DEFAULT_CHORD, isMacPlatform } from "../lib/shortcut";
import { loadComparison, sha256Hex, type Comparison, type FetchLike } from "../github/comparison";
import { publishComment, type LineTarget } from "../github/publish";
import { parsePullUrl, pullPath, type PullRef } from "../github/pull";
import { loadSourceLines } from "../github/source";
import { CommentBox, UI_ATTRIBUTE } from "./comment-box";

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
  selectedText: string;
  target: LineTarget | null;
  comparison: Comparison | null;
  root: Element;
  /** The element the composer was inserted into, merged back on cancel. */
  parent: Node | null;
}

/** Wires selection, resolution, the comment box, and publication together. */
export class Controller {
  private readonly posted: Range[] = [];
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
    // When a selection is finished, an invisible composer takes focus, so the
    // next key types into it (through the IME when one is active) instead of
    // reaching GitHub's single-key shortcuts.
    this.doc.addEventListener("mouseup", (e) => {
      if (e.button === 0) setTimeout(() => this.onSelectionFinished(), 0);
    });
    this.doc.addEventListener("keyup", (e) => {
      if (e.key === "Shift") this.onSelectionFinished();
    });
    // An empty composer is dismissed by clicking elsewhere, like a popover.
    this.doc.addEventListener("mousedown", (e) => {
      const draft = this.draft;
      if (!draft || !isBlankComment(draft.box.body)) return;
      if (e.target instanceof Node && draft.box.host.contains(e.target)) return;
      this.closeDraft();
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

  private onSelectionFinished(): void {
    const sel = this.doc.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0 || !sel.toString().trim()) return;
    if (!parsePullUrl(this.doc.location.href)) return;
    const range = sel.getRangeAt(0);
    if (!this.selectionRoot(range)) return;
    // A composer that already holds text is not replaced by a new selection.
    if (this.draft && !isBlankComment(this.draft.box.body)) return;
    this.armDraft(range.cloneRange());
  }

  /** Insert an invisible composer beneath the selection and give it focus. */
  armDraft(range: Range): void {
    const pull = parsePullUrl(this.doc.location.href);
    const root = this.selectionRoot(range);
    if (!pull || !root) return;
    this.closeDraft();

    const selectedText = range.toString();
    const box = new CommentBox(this.doc, {
      chord: DEFAULT_CHORD,
      mac: this.mac,
      destination: "Post to GitHub",
      avatarUrl: viewerAvatarUrl(this.doc),
      onConfirm: (body) => void this.confirm(body),
      onCancel: () => this.closeDraft(),
      onReveal: () => void this.revealDraft(draft),
      onDisarm: () => this.closeDraft({ restoreSelection: true }),
    });
    box.arm(selectedText);
    insertBeneathLine(range, root, box.host);
    const draft: Draft = { pull, box, range, root, selectedText, target: null, comparison: null, parent: box.host.parentNode };
    this.draft = draft;
    box.focus();
    this.paintHighlights();
  }

  /** The reviewer started typing: show the composer and resolve its target. */
  private async revealDraft(draft: Draft): Promise<void> {
    if (this.draft !== draft) return;
    this.paintHighlights();
    const { box, range, root, pull } = draft;
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
    if (!draft.box.host.isConnected || !this.selectionRoot(draft.range)) {
      box.showStatus("The page changed since you selected the text. Select it again.", "error");
      return;
    }

    box.setBusy(true);
    box.showStatus("Posting to GitHub…", "info");
    const result = await publishComment(draft.pull, comparison, target, buildCommentBody(draft.selectedText, body), this.fetchFn);
    box.setBusy(false);

    if (result.state === "published") {
      // The composer stays where it is and becomes the finished comment.
      box.showPosted(body, describeTarget(target), result.url ?? `${pullPath(draft.pull)}/files`);
      this.posted.push(draft.range);
      this.draft = null;
      this.paintHighlights();
      return;
    }
    if (result.state === "unknown") {
      box.showStatus(result.reason, "error", { href: `${pullPath(draft.pull)}/files`, text: "Open the pull request" });
      return;
    }
    box.showStatus(result.reason, "error");
  }

  private closeDraft(options: { restoreSelection?: boolean } = {}): void {
    const draft = this.draft;
    this.draft = null;
    if (draft) {
      draft.box.host.remove();
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
    const armed = this.draft?.box.isArmed ? this.draft.range : null;
    const drafting = this.draft && !this.draft.box.isArmed ? this.draft.range : null;
    if (armed) css.highlights.set(ARMED_HIGHLIGHT, new HighlightCtor(armed));
    else css.highlights.delete(ARMED_HIGHLIGHT);
    if (drafting) css.highlights.set(DRAFT_HIGHLIGHT, new HighlightCtor(drafting));
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

