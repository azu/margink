import { alternateChord, describeChord, hasAlternateChord, keyAction, type ConfirmChord } from "../lib/shortcut";
import type { Delivery } from "../github/publish";

export const UI_ATTRIBUTE = "data-margink-ui";

/**
 * Visual language for the inline composer.
 *
 * The composer is a quiet card that sits in the document flow: a thin
 * border, a slightly raised background, and a colored bar on the left.
 * The bar uses the accent of the passage underline, so the two read as one
 * unit. A finished comment keeps the same card shape without the bar, the
 * way a comment at rest looks once the reviewer has moved on.
 * The card is an inline-block so GitHub's insertion/deletion underline
 * does not propagate into it when it sits inside a changed paragraph.
 */
const STYLE = `
:host { all: initial; display: inline-block; box-sizing: border-box; width: 100%; vertical-align: top; margin: 8px 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif; font-size: 16px; line-height: 1.5; color: var(--fgColor-default, #1f2328); text-indent: 0; text-align: start; white-space: normal; }
:host([data-armed]) { position: absolute; width: 0; height: 0; margin: 0; overflow: hidden; opacity: 0; }
.card { position: relative; border: 1px solid var(--borderColor-muted, #d1d9e0b3); border-radius: 6px; background: var(--bgColor-muted, #f6f8fa); padding: 10px 12px 10px 14px; }
.card::before { content: ""; position: absolute; left: -1px; top: -1px; bottom: -1px; width: 3px; border-radius: 6px 0 0 6px; background: var(--margink-bar); }
.card[data-state="draft"] { --margink-bar: var(--margink-accent, #8250df); }
.card[data-state="posted"] { --margink-bar: transparent; }
.card[data-pending] { border-style: dashed; }
.main { display: flex; align-items: flex-start; gap: 10px; }
.avatar { width: 20px; height: 20px; border-radius: 50%; flex: none; margin-top: 2px; background: var(--bgColor-neutral-muted, #818b981f); }
textarea { flex: 1; box-sizing: border-box; min-height: 24px; max-height: 50vh; resize: none; overflow-y: auto; font: inherit; padding: 0; margin: 0; border: 0; outline: none; background: transparent; color: inherit; caret-color: var(--fgColor-accent, #0969da); }
textarea::placeholder { color: var(--fgColor-muted, #59636e); }
textarea[readonly] { opacity: .6; }
.footer { display: flex; flex-wrap: wrap; align-items: baseline; column-gap: 12px; margin: 2px 0 0 30px; }
.footer .where { flex: 1 1 14em; margin: 0; }
.actions { flex: none; margin-left: auto; display: flex; gap: 12px; }
.send { flex: none; border: 0; padding: 0 2px; background: none; font: inherit; font-size: 12px; line-height: 24px; color: var(--fgColor-muted, #59636e); cursor: pointer; white-space: nowrap; }
.send:hover:not(:disabled) { color: var(--fgColor-accent, #0969da); }
.send:disabled { opacity: .5; cursor: default; }
.text { flex: 1; white-space: pre-wrap; overflow-wrap: anywhere; }
.where { margin: 2px 0 0 30px; font-size: 12px; color: var(--fgColor-muted, #59636e); }
.where:empty { display: none; }
.status { margin: 2px 0 0 30px; font-size: 12px; }
.status:empty { display: none; }
.status[data-kind="error"] { color: var(--fgColor-danger, #d1242f); }
a { color: inherit; text-decoration: underline; text-decoration-color: var(--fgColor-muted, #59636e); text-underline-offset: 2px; }
@media (prefers-color-scheme: dark) {
  :host { color: var(--fgColor-default, #f0f6fc); }
  .card { background: var(--bgColor-muted, #151b23); border-color: var(--borderColor-muted, #3d444db3); }
  .card[data-state="draft"] { --margink-bar: var(--margink-accent, #ab7aca); }
}
`;

export interface CommentBoxOptions {
  chord: ConfirmChord;
  mac: boolean;
  /** Where a published comment goes, shown as the publish control's tooltip. */
  destination: string;
  /** The signed-in reviewer's avatar, shown like a comment's author. */
  avatarUrl?: string | null;
  onConfirm(body: string, delivery: Delivery): void;
  onCancel(): void;
  /** Called once when the reviewer starts typing in an armed composer. */
  onReveal?(): void;
  /** Called when a key that is not typing reaches an armed composer. */
  onDisarm?(): void;
}

/** The inline comment composer. It renders inside a shadow root. */
export class CommentBox {
  readonly host: HTMLElement;
  private readonly shadow: ShadowRoot;
  private readonly card: HTMLElement;
  private readonly textarea: HTMLTextAreaElement;
  private readonly targetLabel: HTMLElement;
  private readonly status: HTMLElement;
  private readonly publishButton: HTMLButtonElement;
  private readonly reviewButton: HTMLButtonElement;
  private busy = false;
  private ready = false;
  private armed = false;

  constructor(doc: Document, private readonly options: CommentBoxOptions) {
    this.host = doc.createElement("div");
    this.host.setAttribute(UI_ATTRIBUTE, "comment-box");
    this.shadow = this.host.attachShadow({ mode: "open" });
    this.shadow.innerHTML = `<style>${STYLE}</style>
      <div class="card" data-state="draft" role="group" aria-label="Margink comment">
        <div class="main">
          <img class="avatar" alt="">
          <textarea rows="1" aria-label="Comment"></textarea>
        </div>
        <div class="footer">
          <div class="where">Locating the selected text…</div>
          <span class="actions">
            <button type="button" class="send publish" disabled></button>
            <button type="button" class="send review" disabled></button>
          </span>
        </div>
        <div class="status" role="status" aria-live="polite"></div>
      </div>`;
    this.card = this.shadow.querySelector(".card")!;
    this.textarea = this.shadow.querySelector("textarea")!;
    this.targetLabel = this.shadow.querySelector(".where")!;
    this.status = this.shadow.querySelector(".status")!;
    this.publishButton = this.shadow.querySelector(".publish")!;
    this.reviewButton = this.shadow.querySelector(".review")!;

    // As in GitHub's diff comment box, the confirm chord adds the comment to
    // the pending review and the chord with Shift publishes it at once.
    // Short labels keep the target line readable; tooltips spell them out.
    const review = describeChord(options.chord, options.mac);
    this.reviewButton.textContent = `Review ${review}`;
    this.reviewButton.title = `Add to your pending review; submit it in GitHub (${review})`;
    const publish = hasAlternateChord(options.chord) ? describeChord(alternateChord(options.chord), options.mac) : "";
    this.publishButton.textContent = publish ? `Post ${publish}` : "Post";
    this.publishButton.title = publish ? `${options.destination} (${publish})` : options.destination;
    this.textarea.placeholder = "Comment";
    const avatar = this.shadow.querySelector<HTMLImageElement>(".avatar")!;
    // A missing avatar leaves the neutral circle instead of a broken image.
    avatar.addEventListener("error", () => {
      avatar.src = "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==";
    }, { once: true });
    if (options.avatarUrl) avatar.src = options.avatarUrl;

    this.publishButton.addEventListener("click", () => this.confirm("publish"));
    this.reviewButton.addEventListener("click", () => this.confirm("review"));
    // Typing or IME composition in an armed composer reveals it in place.
    // The text area keeps focus, so the composition continues uninterrupted.
    this.textarea.addEventListener("compositionstart", () => this.reveal());
    this.textarea.addEventListener("beforeinput", () => this.reveal());
    this.textarea.addEventListener("input", () => {
      this.autosize();
      if (this.status.dataset.kind === "error" && this.ready) this.showStatus("", "info");
    });
    this.textarea.addEventListener("keydown", (event) => {
      event.stopPropagation(); // Keep GitHub's page shortcuts away from the composer.
      if (this.armed && isPageKey(event)) {
        // Navigation keys belong to the page while nothing is typed. Moving
        // focus away during the keydown lets the page scroll as usual.
        this.textarea.blur();
        this.options.onDisarm?.();
        return;
      }
      if (event.key === "Escape" && !event.isComposing) {
        event.preventDefault();
        this.options.onCancel();
        return;
      }
      // "newline" and "none" keep the textarea's default behavior.
      const action = keyAction(event, options.chord, options.mac);
      if (action === "confirm" || action === "alternate") {
        event.preventDefault();
        this.confirm(action === "confirm" ? "review" : "publish");
      }
    });
    this.textarea.addEventListener("keyup", (e) => e.stopPropagation());
    this.textarea.addEventListener("keypress", (e) => e.stopPropagation());
  }

  /**
   * Prepare the composer without showing it: it takes no space, but its text
   * area has focus, so the first key (including IME input) goes into it.
   * `copyText` is what copying copies while armed: the selected passage.
   */
  arm(copyText?: string): void {
    this.armed = true;
    this.host.setAttribute("data-armed", "");
    if (copyText === undefined) return;
    // Copying while armed copies the selected passage, as the page would.
    this.textarea.addEventListener("copy", (event) => {
      if (!this.armed || !event.clipboardData) return;
      event.clipboardData.setData("text/plain", copyText);
      event.preventDefault();
    });
  }

  get isArmed(): boolean {
    return this.armed;
  }

  private reveal(): void {
    if (!this.armed) return;
    this.armed = false;
    this.host.removeAttribute("data-armed");
    this.options.onReveal?.();
  }

  get body(): string {
    return this.textarea.value;
  }

  set body(value: string) {
    this.textarea.value = value;
    this.autosize();
  }

  focus(): void {
    this.textarea.focus({ preventScroll: true });
  }

  setTarget(label: string, title = label): void {
    this.targetLabel.textContent = label;
    this.targetLabel.title = title;
    this.ready = true;
    this.refreshButton();
  }

  setUnavailable(reason: string): void {
    this.targetLabel.textContent = "";
    this.ready = false;
    this.showStatus(reason, "error");
    this.refreshButton();
  }

  setBusy(busy: boolean): void {
    this.busy = busy;
    this.textarea.readOnly = busy;
    this.refreshButton();
  }

  showStatus(message: string, kind: "error" | "info", link?: { href: string; text: string }): void {
    this.status.textContent = message;
    this.status.dataset.kind = kind;
    if (link) {
      const a = this.status.ownerDocument.createElement("a");
      a.href = link.href;
      a.target = "_blank";
      a.rel = "noopener";
      a.textContent = link.text;
      this.status.append(" ", a);
    }
  }

  /**
   * Turn the composer into the finished comment: the same card without the
   * accent bar, the comment text, and a link to it on GitHub.
   */
  showPosted(body: string, location: string, href: string, delivery: Delivery = "publish", title = location): void {
    const doc = this.host.ownerDocument;
    this.card.dataset.state = "posted";
    this.card.setAttribute("aria-label", "Margink comment, posted");
    const text = doc.createElement("div");
    text.className = "text";
    text.textContent = body.trim();
    this.textarea.replaceWith(text);
    this.publishButton.parentElement?.remove();
    this.status.textContent = "";
    this.targetLabel.textContent = "";
    const link = doc.createElement("a");
    link.href = href;
    link.target = "_blank";
    link.rel = "noopener";
    link.textContent = delivery === "publish" ? `Posted · ${location}` : `Pending review · ${location}`;
    link.title = delivery === "publish" ? `Posted on GitHub: ${title}` : `Added to your pending review: ${title}. Submit the review on GitHub.`;
    this.targetLabel.title = "";
    if (delivery === "review") this.card.dataset.pending = "";
    this.targetLabel.append(link);
    this.host.setAttribute(UI_ATTRIBUTE, "posted-comment");
  }

  private autosize(): void {
    this.textarea.style.height = "auto";
    this.textarea.style.height = `${this.textarea.scrollHeight}px`;
  }

  private refreshButton(): void {
    this.publishButton.disabled = this.busy || !this.ready;
    this.reviewButton.disabled = this.publishButton.disabled;
  }

  private confirm(delivery: Delivery): void {
    if (this.busy || !this.ready) return;
    this.options.onConfirm(this.textarea.value, delivery);
  }
}

/**
 * Keys that act on the page rather than type text: navigation, Space
 * (which scrolls the page), Tab, and shortcuts with Command or Control
 * (copying is handled separately). An armed composer hands these back.
 */
export function isPageKey(event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "isComposing">): boolean {
  if (event.isComposing) return false;
  if (event.ctrlKey || event.metaKey) return !/^[cC]$/.test(event.key);
  if (event.altKey) return false; // Alt produces characters on some layouts.
  return /^(Arrow|Page|Home$|End$|Tab$| $)/.test(event.key);
}
