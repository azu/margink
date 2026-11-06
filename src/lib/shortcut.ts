/** A key chord that confirms a comment. Enter is always the key. */
export interface ConfirmChord {
  /** Command on macOS, Control elsewhere. */
  primary: boolean;
  shift: boolean;
  alt: boolean;
}

export const DEFAULT_CHORD: ConfirmChord = { primary: true, shift: false, alt: false };

export function isMacPlatform(platform: string): boolean {
  return /mac|iphone|ipad|ipod/i.test(platform);
}

export interface KeyLike {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  isComposing?: boolean;
  keyCode?: number;
}

export type KeyAction = "confirm" | "newline" | "none";

/**
 * Decide what a keydown in the comment box does.
 * Composition always wins, so Enter that finishes IME conversion never confirms.
 */
export function keyAction(event: KeyLike, chord: ConfirmChord, mac: boolean): KeyAction {
  if (event.isComposing || event.keyCode === 229) return "none";
  if (event.key !== "Enter") return "none";

  const primary = mac ? event.metaKey : event.ctrlKey;
  const otherPrimary = mac ? event.ctrlKey : event.metaKey;
  if (otherPrimary) return "none";

  if (primary === chord.primary && event.shiftKey === chord.shift && event.altKey === chord.alt) {
    return "confirm";
  }
  // Plain Enter is a newline unless it confirms; then Shift+Enter is the newline.
  const plain = !primary && !event.shiftKey && !event.altKey;
  const shiftOnly = !primary && event.shiftKey && !event.altKey;
  if (plain || shiftOnly) return "newline";
  return "none";
}

export function describeChord(chord: ConfirmChord, mac: boolean): string {
  const parts: string[] = [];
  if (chord.primary) parts.push(mac ? "⌘" : "Ctrl");
  if (chord.alt) parts.push(mac ? "⌥" : "Alt");
  if (chord.shift) parts.push(mac ? "⇧" : "Shift");
  parts.push("Enter");
  return parts.join(mac ? "" : "+");
}
