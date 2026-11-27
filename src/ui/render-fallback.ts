import { RENDERED_ATTRIBUTE } from "../lib/rendered";
import { UI_ATTRIBUTE } from "./comment-box";

/**
 * The notice GitHub shows in place of a rich diff it cannot render, such as
 * "This rich diff is not supported at the moment." Matched loosely, because
 * the wording and markup are GitHub's and can change.
 */
export const UNSUPPORTED_NOTICE = "rich diff is not supported";

const NOTICE_XPATH = `//*[not(self::script) and not(self::style) and contains(text(), "${UNSUPPORTED_NOTICE}")]`;

/** Page content that can quote the notice's words without being the notice. */
const CONTENT = "td, pre, code, textarea, table, .markdown-body, .comment-body, .blob-code, .diff-text-cell, [contenteditable]";

/** Marks a notice that already has a Margink button, so it gets only one. */
const HANDLED_ATTRIBUTE = "data-margink-render-notice";

/** Render a file's Markdown and return it, or throw an error with a message for the reviewer. */
export type RenderFile = (notice: Element) => Promise<DocumentFragment>;

/** Find GitHub's unsupported rich diff notices that have no Margink button yet. */
export function findUnsupportedNotices(doc: Document): Element[] {
  const found: Element[] = [];
  const result = doc.evaluate(NOTICE_XPATH, doc.body ?? doc, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
  for (let i = 0; i < result.snapshotLength; i++) {
    const el = result.snapshotItem(i) as Element;
    if (el.closest(`[${UI_ATTRIBUTE}], [${RENDERED_ATTRIBUTE}], [${HANDLED_ATTRIBUTE}]`)) continue;
    // The same words can appear in a diff, a comment, or a document; only
    // GitHub's own notice, whose whole text is the message, counts.
    if (el.closest(CONTENT)) continue;
    if (!/^this rich diff is not supported\b[^\n]{0,40}$/i.test((el.textContent ?? "").trim())) continue;
    if (!isNoticeShown(el)) continue;
    found.push(el);
  }
  return found;
}

/** The file container a notice belongs to, as GitHub marks it. */
const FILE_CONTAINER = "[id^='diff-'], [data-path], [data-tagsearch-path], [data-file-path]";

/**
 * Whether a notice is actually shown for its file: the reviewer can see it,
 * and GitHub has not rendered a rich diff for the same file. A notice that
 * GitHub keeps in the page but hides is not acted on.
 */
export function isNoticeShown(notice: Element): boolean {
  const el = notice as Element & { checkVisibility?: (options?: object) => boolean };
  // Without layout (as in unit tests), the notice counts as shown.
  if (el.checkVisibility && !el.checkVisibility({ visibilityProperty: true, opacityProperty: true })) return false;
  const file = notice.closest(FILE_CONTAINER);
  if (!file) return true;
  for (const prose of file.querySelectorAll(".prose-diff, .rich-diff")) {
    const p = prose as Element & { checkVisibility?: () => boolean };
    if (p.checkVisibility?.() ?? true) return false;
  }
  return true;
}

/**
 * Render the file's version after the change below each notice GitHub
 * shows when it cannot render a rich diff, as a rendered view Margink can
 * comment on. It renders automatically when the notice comes near the
 * viewport and then hides the notice. After a failure, the reason and a
 * retry button appear beside the notice.
 */
export class RenderFallback {
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly doc: Document,
    private readonly render: RenderFile,
    private readonly isPullPage: () => boolean,
  ) {}

  start(): void {
    this.scan();
    // GitHub loads files lazily and navigates without reloading, so notices
    // appear later. Only the page is read; nothing is requested from GitHub.
    const view = this.doc.defaultView;
    if (!view?.MutationObserver || !this.doc.body) return;
    new view.MutationObserver(() => this.scanSoon()).observe(this.doc.body, {
      childList: true,
      subtree: true,
      // A notice GitHub keeps hidden can be shown later by a class or style change.
      attributes: true,
      attributeFilter: ["class", "hidden", "style"],
    });
  }

  private scanSoon(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.scan();
    }, 300);
  }

  scan(): void {
    if (!this.isPullPage()) return;
    for (const notice of findUnsupportedNotices(this.doc)) this.attach(notice);
  }

  private attach(notice: Element): void {
    notice.setAttribute(HANDLED_ATTRIBUTE, "");
    const bar = this.doc.createElement("div");
    bar.setAttribute(UI_ATTRIBUTE, "render-bar");
    bar.style.cssText = "display:none;align-items:center;justify-content:center;gap:8px;margin:8px 0;flex-wrap:wrap";
    const button = this.doc.createElement("button");
    button.type = "button";
    button.className = "btn btn-sm";
    button.textContent = "Render Markdown";
    button.title = "Margink renders this file's Markdown (after the change) so you can read and comment on it";
    const status = this.doc.createElement("span");
    status.className = "color-fg-muted";
    status.setAttribute("role", "status");
    bar.append(button, status);
    // The bar is shown only when rendering fails, to give the reason and a retry.
    notice.after(bar);

    let view: HTMLElement | null = null;
    let rendering = false;
    const renderNow = async () => {
      if (view || rendering) return;
      // GitHub may have hidden the notice or rendered the file since then.
      // Forget this notice, so a later scan picks it up if it is shown again.
      if (!isNoticeShown(notice)) {
        notice.removeAttribute(HANDLED_ATTRIBUTE);
        bar.remove();
        return;
      }
      rendering = true;
      button.disabled = true;
      status.textContent = "Rendering…";
      try {
        const fragment = await this.render(notice);
        view = this.doc.createElement("div");
        view.setAttribute(RENDERED_ATTRIBUTE, "head");
        view.style.cssText = "text-align:left;padding:16px 32px;border-top:1px solid var(--borderColor-muted, #d1d9e0)";
        const article = this.doc.createElement("article");
        article.className = "markdown-body";
        article.append(fragment);
        view.append(article);
        bar.after(view);
        // The rendered file replaces GitHub's notice and Margink's bar, which
        // would only take space above it. GitHub's own source/rich toggle
        // still switches to the source diff.
        (notice as HTMLElement).style.display = "none";
      } catch (error) {
        bar.style.display = "flex";
        status.textContent = error instanceof Error ? error.message : String(error);
      } finally {
        rendering = false;
        button.disabled = false;
      }
    };
    button.addEventListener("click", (event) => {
      event.preventDefault();
      void renderNow();
    });
    this.renderWhenNear(notice, renderNow);
  }

  /**
   * Render a file automatically once it comes near the viewport, so a pull
   * request with many such files does not request every source at once.
   * Without IntersectionObserver, it renders right away.
   */
  private renderWhenNear(target: Element, renderNow: () => Promise<void>): void {
    const view = this.doc.defaultView;
    if (!view?.IntersectionObserver) return void renderNow();
    const observer = new view.IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        observer.disconnect();
        void renderNow();
      },
      { rootMargin: "800px 0px" },
    );
    observer.observe(target);
  }
}
