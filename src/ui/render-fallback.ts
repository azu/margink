import { RENDERED_ATTRIBUTE } from "../lib/rendered";
import { UI_ATTRIBUTE } from "./comment-box";

/**
 * The notice GitHub shows in place of a rich diff it cannot render, such as
 * "This rich diff is not supported at the moment." Matched loosely, because
 * the wording and markup are GitHub's and can change.
 */
export const UNSUPPORTED_NOTICE = "rich diff is not supported";

const NOTICE_XPATH = `//*[not(self::script) and not(self::style) and contains(text(), "${UNSUPPORTED_NOTICE}")]`;

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
    found.push(el);
  }
  return found;
}

/**
 * Add a "Render Markdown" button beside each notice GitHub shows when it
 * cannot render a rich diff. The button renders the file's version after
 * the change below the notice, as a rendered view Margink can comment on,
 * and then toggles it.
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
    new view.MutationObserver(() => this.scanSoon()).observe(this.doc.body, { childList: true, subtree: true });
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
    bar.style.cssText = "display:flex;align-items:center;justify-content:center;gap:8px;margin:8px 0;flex-wrap:wrap";
    const button = this.doc.createElement("button");
    button.type = "button";
    button.className = "btn btn-sm";
    button.textContent = "Render Markdown";
    button.title = "Margink renders this file's Markdown (after the change) so you can read and comment on it";
    const status = this.doc.createElement("span");
    status.className = "color-fg-muted";
    status.setAttribute("role", "status");
    bar.append(button, status);
    notice.after(bar);

    let view: HTMLElement | null = null;
    button.addEventListener("click", async (event) => {
      event.preventDefault();
      if (view) {
        view.hidden = !view.hidden;
        button.textContent = view.hidden ? "Show rendered Markdown" : "Hide rendered Markdown";
        return;
      }
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
        status.textContent = "";
        button.textContent = "Hide rendered Markdown";
      } catch (error) {
        status.textContent = error instanceof Error ? error.message : String(error);
      } finally {
        button.disabled = false;
      }
    });
  }
}
