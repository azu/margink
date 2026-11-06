import { describeChord, keyAction, type ConfirmChord } from "../lib/shortcut";

export const UI_ATTRIBUTE = "data-margink-ui";

const STYLE = `
:host { all: initial; display: block; margin: 8px 0 12px; font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif; color: var(--fgColor-default, #1f2328); }
.box { border: 1px solid var(--borderColor-default, #d1d9e0); border-radius: 6px; background: var(--bgColor-default, #fff); padding: 8px; }
.target { font-size: 12px; color: var(--fgColor-muted, #59636e); margin-bottom: 6px; display: flex; gap: 8px; flex-wrap: wrap; }
.mode { font-weight: 600; }
textarea { box-sizing: border-box; width: 100%; min-height: 72px; resize: vertical; font: inherit; padding: 6px 8px; border: 1px solid var(--borderColor-default, #d1d9e0); border-radius: 6px; background: var(--bgColor-default, #fff); color: inherit; }
.row { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 6px; }
.hint { font-size: 12px; color: var(--fgColor-muted, #59636e); }
.buttons { display: flex; gap: 6px; }
button { font: inherit; font-size: 13px; padding: 3px 12px; border-radius: 6px; border: 1px solid var(--borderColor-default, #d1d9e0); background: var(--bgColor-muted, #f6f8fa); color: inherit; cursor: pointer; }
button.primary { background: var(--bgColor-success-emphasis, #1f883d); border-color: transparent; color: #fff; }
button:disabled { opacity: .6; cursor: default; }
.status { font-size: 12px; margin-top: 6px; }
.status[data-kind="error"] { color: var(--fgColor-danger, #d1242f); }
.status[data-kind="success"] { color: var(--fgColor-success, #1a7f37); }
a { color: var(--fgColor-accent, #0969da); }
@media (prefers-color-scheme: dark) {
  :host { color: var(--fgColor-default, #f0f6fc); }
  .box, textarea { background: var(--bgColor-default, #0d1117); border-color: var(--borderColor-default, #3d444d); }
  button { background: var(--bgColor-muted, #151b23); border-color: var(--borderColor-default, #3d444d); }
}
`;

export interface CommentBoxOptions {
  chord: ConfirmChord;
  mac: boolean;
  modeLabel: string;
  onConfirm(body: string): void;
  onCancel(): void;
}

/** The comment input shown beneath a passage. It renders inside a shadow root. */
export class CommentBox {
  readonly host: HTMLElement;
  private readonly textarea: HTMLTextAreaElement;
  private readonly targetLabel: HTMLElement;
  private readonly status: HTMLElement;
  private readonly confirmButton: HTMLButtonElement;
  private busy = false;
  private ready = false;

  constructor(doc: Document, private readonly options: CommentBoxOptions) {
    this.host = doc.createElement("div");
    this.host.setAttribute(UI_ATTRIBUTE, "comment-box");
    const shadow = this.host.attachShadow({ mode: "open" });
    shadow.innerHTML = `<style>${STYLE}</style>
      <div class="box" role="group" aria-label="Margink comment">
        <div class="target"><span class="mode"></span><span class="where">Locating the selected text…</span></div>
        <textarea aria-label="Comment" placeholder="Leave a comment"></textarea>
        <div class="row">
          <span class="hint"></span>
          <span class="buttons"><button type="button" class="cancel">Cancel</button><button type="button" class="primary confirm" disabled>Comment</button></span>
        </div>
        <div class="status" role="status" aria-live="polite"></div>
      </div>`;
    this.textarea = shadow.querySelector("textarea")!;
    this.targetLabel = shadow.querySelector(".where")!;
    this.status = shadow.querySelector(".status")!;
    this.confirmButton = shadow.querySelector(".confirm")!;
    shadow.querySelector(".mode")!.textContent = options.modeLabel;
    shadow.querySelector(".hint")!.textContent = `${describeChord(options.chord, options.mac)} to comment`;

    this.confirmButton.addEventListener("click", () => this.confirm());
    shadow.querySelector(".cancel")!.addEventListener("click", () => options.onCancel());
    this.textarea.addEventListener("keydown", (event) => {
      event.stopPropagation(); // Keep GitHub's page shortcuts away from the box.
      const action = keyAction(event, options.chord, options.mac);
      // "newline" and "none" keep the textarea's default behavior.
      if (action === "confirm") {
        event.preventDefault();
        this.confirm();
      }
    });
    this.textarea.addEventListener("input", () => {
      if (this.status.dataset.kind === "error" && this.ready) this.showStatus("", "info");
    });
    this.textarea.addEventListener("keyup", (e) => e.stopPropagation());
    this.textarea.addEventListener("keypress", (e) => e.stopPropagation());
  }

  get body(): string {
    return this.textarea.value;
  }

  set body(value: string) {
    this.textarea.value = value;
  }

  focus(): void {
    this.textarea.focus();
  }

  setTarget(label: string): void {
    this.targetLabel.textContent = label;
    this.ready = true;
    this.refreshButton();
  }

  setUnavailable(reason: string): void {
    this.targetLabel.textContent = "No target";
    this.ready = false;
    this.showStatus(reason, "error");
    this.refreshButton();
  }

  setBusy(busy: boolean): void {
    this.busy = busy;
    this.textarea.readOnly = busy;
    this.confirmButton.textContent = busy ? "Commenting…" : "Comment";
    this.refreshButton();
  }

  showStatus(message: string, kind: "error" | "info" | "success", link?: { href: string; text: string }): void {
    this.status.textContent = message;
    this.status.dataset.kind = kind;
    if (link) {
      const a = this.status.ownerDocument.createElement("a");
      a.href = link.href;
      a.textContent = link.text;
      this.status.append(" ", a);
    }
  }

  private refreshButton(): void {
    this.confirmButton.disabled = this.busy || !this.ready;
  }

  private confirm(): void {
    if (this.busy) return;
    if (!this.ready) return;
    this.options.onConfirm(this.textarea.value);
  }
}
