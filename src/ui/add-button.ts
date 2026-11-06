import { UI_ATTRIBUTE } from "./comment-box";

/**
 * The add button, modeled on the "+" GitHub shows beside a hovered line in
 * a source diff: a small blue square with a plus, in the left margin of the
 * hovered block. Clicking it starts a comment on that whole block.
 */
const STYLE = `
:host { all: initial; position: absolute; z-index: 30; display: none; }
:host([data-visible]) { display: block; }
button { box-sizing: border-box; width: 22px; height: 22px; padding: 0; border: 0; border-radius: 6px; display: grid; place-items: center; cursor: pointer;
  background: var(--bgColor-accent-emphasis, #0969da); color: var(--fgColor-onEmphasis, #ffffff);
  box-shadow: 0 1px 0 rgba(31, 35, 40, .1); transition: transform 80ms ease-out; }
button:hover { transform: scale(1.15); }
button:focus-visible { outline: 2px solid var(--fgColor-accent, #0969da); outline-offset: 2px; }
svg { display: block; fill: currentColor; }
@media (prefers-color-scheme: dark) {
  button { background: var(--bgColor-accent-emphasis, #1f6feb); }
}
`;

const SIZE = 22;
const GAP = 6;

export class AddButton {
  readonly host: HTMLElement;
  private readonly button: HTMLButtonElement;
  private block: Element | null = null;
  private root: Element | null = null;

  constructor(doc: Document, onClick: (block: Element, root: Element) => void) {
    this.host = doc.createElement("div");
    this.host.setAttribute(UI_ATTRIBUTE, "add-button");
    const shadow = this.host.attachShadow({ mode: "open" });
    shadow.innerHTML = `<style>${STYLE}</style>
      <button type="button" aria-label="Comment on this block" title="Comment on this block">
        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M7.75 2a.75.75 0 0 1 .75.75V7h4.25a.75.75 0 0 1 0 1.5H8.5v4.25a.75.75 0 0 1-1.5 0V8.5H2.75a.75.75 0 0 1 0-1.5H7V2.75A.75.75 0 0 1 7.75 2Z"></path></svg>
      </button>`;
    this.button = shadow.querySelector("button")!;
    this.button.addEventListener("click", (event) => {
      event.preventDefault();
      const { block, root } = this;
      this.hide();
      if (block?.isConnected && root) onClick(block, root);
    });
  }

  private hideTimer: ReturnType<typeof setTimeout> | null = null;

  /** Hide shortly, so the pointer can cross the gap between a block and the button. */
  hideSoon(): void {
    if (!this.block || this.hideTimer) return;
    this.hideTimer = setTimeout(() => this.hide(), 250);
  }

  /** Keep the button, cancelling a pending hide. */
  keep(): void {
    if (this.hideTimer) clearTimeout(this.hideTimer);
    this.hideTimer = null;
  }

  get target(): Element | null {
    return this.block;
  }

  show(block: Element, root: Element): void {
    this.keep();
    if (!this.host.isConnected) block.ownerDocument.body.append(this.host);
    this.block = block;
    this.root = root;
    this.host.setAttribute("data-visible", "");
    this.reposition();
  }

  hide(): void {
    this.keep();
    this.block = null;
    this.root = null;
    this.host.removeAttribute("data-visible");
  }

  /**
   * Place the button in the file's left margin, level with the block's
   * first line. Every block uses the same column, like GitHub's gutter.
   */
  reposition(): void {
    const { block, root } = this;
    if (!block || !root) return;
    if (!block.isConnected) return this.hide();
    const view = block.ownerDocument.defaultView;
    const rootRect = root.getBoundingClientRect();
    const padding = parseFloat(view?.getComputedStyle(root).paddingLeft ?? "0") || 0;
    // Just left of the text column, outside the file when it has no margin.
    const left = Math.max(2, rootRect.left + padding - SIZE - GAP);
    const firstLine = firstLineRect(block);
    const top = firstLine.top + Math.max(0, (firstLine.height - SIZE) / 2);
    this.host.style.left = `${left + (view?.scrollX ?? 0)}px`;
    this.host.style.top = `${top + (view?.scrollY ?? 0)}px`;
  }
}

function firstLineRect(block: Element): { top: number; height: number } {
  const range = block.ownerDocument.createRange();
  range.selectNodeContents(block);
  const rects = [...range.getClientRects()].filter((r) => r.height > 0);
  const rect = rects[0] ?? block.getBoundingClientRect();
  return { top: rect.top, height: rect.height };
}
