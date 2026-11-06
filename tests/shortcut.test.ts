import { describe, expect, it } from "vitest";
import { buildCommentBody, isBlankComment } from "../src/lib/comment-body";
import { DEFAULT_CHORD, keyAction } from "../src/lib/shortcut";

const key = (over: Partial<Parameters<typeof keyAction>[0]>) => ({ key: "Enter", metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...over });

describe("default confirm shortcut", () => {
  it("confirms with Command+Enter on macOS and Control+Enter elsewhere", () => {
    expect(keyAction(key({ metaKey: true }), DEFAULT_CHORD, true)).toBe("confirm");
    expect(keyAction(key({ ctrlKey: true }), DEFAULT_CHORD, false)).toBe("confirm");
    expect(keyAction(key({ ctrlKey: true }), DEFAULT_CHORD, true)).toBe("none");
  });

  it("keeps plain Enter as a newline", () => {
    expect(keyAction(key({}), DEFAULT_CHORD, true)).toBe("newline");
  });

  it("never confirms while text is being composed", () => {
    expect(keyAction(key({ metaKey: true, isComposing: true }), DEFAULT_CHORD, true)).toBe("none");
    expect(keyAction(key({ keyCode: 229 }), { primary: false, shift: false, alt: false }, true)).toBe("none");
  });

  it("uses Shift+Enter for newlines when plain Enter confirms", () => {
    const plain = { primary: false, shift: false, alt: false };
    expect(keyAction(key({}), plain, false)).toBe("confirm");
    expect(keyAction(key({ shiftKey: true }), plain, false)).toBe("newline");
  });
});

describe("comment body", () => {
  it("quotes the selected words before the comment", () => {
    expect(buildCommentBody("  some words\nmore ", " Fix this. ")).toBe("> some words\n> more\n\nFix this.");
  });
  it("treats whitespace as blank", () => {
    expect(isBlankComment(" \n\t")).toBe(true);
    expect(isBlankComment("x")).toBe(false);
  });
});

import { isPageKey } from "../src/ui/comment-box";

describe("keys in an armed composer", () => {
  const k = (key: string, over: Partial<KeyboardEvent> = {}) => ({ key, ctrlKey: false, metaKey: false, altKey: false, isComposing: false, ...over });
  it("leaves typing, IME input, and copying to the composer", () => {
    expect(isPageKey(k("k"))).toBe(false);
    expect(isPageKey(k("Process"))).toBe(false);
    expect(isPageKey(k("ArrowDown", { isComposing: true }))).toBe(false);
    expect(isPageKey(k("c", { metaKey: true }))).toBe(false);
  });
  it("hands navigation and other shortcuts back to the page", () => {
    expect(isPageKey(k("ArrowDown"))).toBe(true);
    expect(isPageKey(k("PageDown"))).toBe(true);
    expect(isPageKey(k("Tab"))).toBe(true);
    expect(isPageKey(k("f", { metaKey: true }))).toBe(true);
  });
});
