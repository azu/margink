import { describeChord, keyAction, type ConfirmChord } from "../lib/shortcut";

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
:host([data-armed]) { width: 0; height: 0; margin: 0; overflow: hidden; opacity: 0; }
.card { position: relative; border: 1px solid var(--borderColor-muted, #d1d9e0b3); border-radius: 6px; background: var(--bgColor-muted, #f6f8fa); padding: 10px 12px 10px 14px; }
.card::before { content: ""; position: absolute; left: -1px; top: -1px; bottom: -1px; width: 3px; border-radius: 6px 0 0 6px; background: var(--margink-bar); }
.card[data-state="draft"] { --margink-bar: var(--margink-accent, #8250df); }
.card[data-state="posted"] { --margink-bar: transparent; }
.main { display: flex; align-items: flex-start; gap: 10px; }
.avatar { width: 20px; height: 20px; border-radius: 50%; flex: none; margin-top: 2px; background: var(--bgColor-neutral-muted, #818b981f); }
textarea { flex: 1; box-sizing: border-box; min-height: 24px; max-height: 50vh; resize: none; overflow-y: auto; font: inherit; padding: 0; margin: 0; border: 0; outline: none; background: transparent; color: inherit; caret-color: var(--fgColor-accent, #0969da); }
textarea::placeholder { color: var(--fgColor-muted, #59636e); }
textarea[readonly] { opacity: .6; }
.send { flex: none; align-self: flex-end; border: 0; padding: 0 2px; background: none; font: inherit; font-size: 12px; line-height: 24px; color: var(--fgColor-muted, #59636e); cursor: pointer; white-space: nowrap; }
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
  /** Where a confirmed comment goes, shown on the confirm control. */
  destination: string;
  /** The signed-in reviewer's avatar, shown like a comment's author. */
  avatarUrl?: string | null;
  onConfirm(body: string): void;
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
  private readonly confirmButton: HTMLButtonElement;
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
          <button type="button" class="send confirm" disabled></button>
        </div>
        <div class="where">Locating the selected text…</div>
        <div class="status" role="status" aria-live="polite"></div>
      </div>`;
    this.card = this.shadow.querySelector(".card")!;
    this.textarea = this.shadow.querySelector("textarea")!;
    this.targetLabel = this.shadow.querySelector(".where")!;
    this.status = this.shadow.querySelector(".status")!;
    this.confirmButton = this.shadow.querySelector(".confirm")!;

    const chord = describeChord(options.chord, options.mac);
    this.confirmButton.textContent = `${options.destination} ${chord}`;
    this.confirmButton.title = `${options.destination} (${chord})`;
    this.textarea.placeholder = "Comment";
    const avatar = this.shadow.querySelector<HTMLImageElement>(".avatar")!;
    // A missing avatar leaves the neutral circle instead of a broken image.
    avatar.addEventListener("error", () => {
      avatar.src = "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==";
    }, { once: true });
    if (options.avatarUrl) avatar.src = options.avatarUrl;

    this.confirmButton.addEventListener("click", () => this.confirm());
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
        // Navigation and editing keys belong to the page while nothing is typed.
        this.options.onDisarm?.();
        return;
      }
      if (event.key === "Escape" && !event.isComposing) {
        event.preventDefault();
        this.options.onCancel();
        return;
      }
      // "newline" and "none" keep the textarea's default behavior.
      if (keyAction(event, options.chord, options.mac) === "confirm") {
        event.preventDefault();
        this.confirm();
      }
    });
    this.textarea.addEventListener("keyup", (e) => e.stopPropagation());
    this.textarea.addEventListener("keypress", (e) => e.stopPropagation());
  }

  /**
   * Prepare the composer without showing it: it takes no space, but its text
   * area has focus, so the first key (including IME input) goes into it.
   */
  arm(copyText: string): void {
    this.armed = true;
    this.host.setAttribute("data-armed", "");
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

  setTarget(label: string): void {
    this.targetLabel.textContent = label;
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
  showPosted(body: string, location: string, href: string): void {
    const doc = this.host.ownerDocument;
    this.card.dataset.state = "posted";
    this.card.setAttribute("aria-label", "Margink comment, posted");
    const text = doc.createElement("div");
    text.className = "text";
    text.textContent = body.trim();
    this.textarea.replaceWith(text);
    this.confirmButton.remove();
    this.status.textContent = "";
    this.targetLabel.textContent = "";
    const link = doc.createElement("a");
    link.href = href;
    link.target = "_blank";
    link.rel = "noopener";
    link.textContent = `Posted on GitHub · ${location}`;
    this.targetLabel.append(link);
    this.host.setAttribute(UI_ATTRIBUTE, "posted-comment");
  }

  private autosize(): void {
    this.textarea.style.height = "auto";
    this.textarea.style.height = `${this.textarea.scrollHeight}px`;
  }

  private refreshButton(): void {
    this.confirmButton.disabled = this.busy || !this.ready;
  }

  private confirm(): void {
    if (this.busy || !this.ready) return;
    this.options.onConfirm(this.textarea.value);
  }
}

/**
 * Keys that act on the page rather than type text: navigation, Tab, and
 * shortcuts with Command, Control, or Alt (copying is handled separately).
 */
export function isPageKey(event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "isComposing">): boolean {
  if (event.isComposing) return false;
  if (event.ctrlKey || event.metaKey) return !/^[cC]$/.test(event.key);
  if (event.altKey) return false; // Alt produces characters on some layouts.
  return /^(Arrow|Page|Home$|End$|Tab$)/.test(event.key);
}
