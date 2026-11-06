/**
 * Text normalization shared by the rendered side and the source side.
 *
 * Both sides are reduced to the same comparable form: whitespace and
 * Markdown punctuation that renderers drop or keep inconsistently are
 * removed, so that "**bold** text" in the source and "bold text" in the
 * rendered page produce the same characters.
 */

/** Characters removed from both sides before comparison. */
const IGNORED = /[\s*_~`\u200b-\u200f\u2028-\u202f\u2060\ufeff]/u;

export function isIgnoredChar(ch: string): boolean {
  return IGNORED.test(ch);
}

/** Normalize a rendered string (for example, a selection's text). */
export function normalizeText(text: string): string {
  let out = "";
  for (const ch of text.normalize("NFKC")) {
    if (!isIgnoredChar(ch)) out += ch;
  }
  return out;
}

/**
 * A normalized copy of a source file with a map back to source lines.
 * `lineOf[i]` is the 1-based source line of `text[i]`.
 */
export interface SourceIndex {
  text: string;
  lineOf: number[];
}

const FENCE = /^\s{0,3}(`{3,}|~{3,})\s*([\w-]*)/;
/** Fenced languages that GitHub renders as diagrams instead of text. */
const DIAGRAM_LANGUAGES = new Set(["mermaid", "geojson", "topojson", "stl"]);

/** Remove Markdown syntax from one source line, keeping visible text. */
export function stripMarkdownLine(line: string): string {
  let s = line;
  // Block-level markers.
  s = s.replace(/^\s{0,3}#{1,6}\s+/, "");
  s = s.replace(/\s+#+\s*$/, "");
  s = s.replace(/^(\s*>)+\s?/, "");
  s = s.replace(/^\s*(?:[-*+]|\d{1,9}[.)])\s+(?:\[[ xX]\]\s+)?/, "");
  // Table pipes become spaces (spaces are ignored later).
  s = s.replace(/\\\|/g, "\u0000").replace(/\|/g, " ").replace(/\u0000/g, "|");
  // Images have no text in the rendered page.
  s = s.replace(/!\[[^\]]*\]\([^)]*\)/g, "");
  s = s.replace(/!\[[^\]]*\]\[[^\]]*\]/g, "");
  // Inline links and reference links keep their text.
  s = s.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
  s = s.replace(/\[([^\]]*)\]\[[^\]]*\]/g, "$1");
  // Autolinks keep their URL.
  s = s.replace(/<((?:https?|mailto):[^>\s]+)>/g, "$1");
  // HTML tags and comments are not visible text.
  s = s.replace(/<!--.*?-->/g, "");
  s = s.replace(/<\/?[A-Za-z][^>]*>/g, "");
  // Backslash escapes.
  s = s.replace(/\\([!-/:-@[-`{-~])/g, "$1");
  // Common entities.
  s = s
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
  return s;
}

const TABLE_DIVIDER = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/;
const REFERENCE_DEFINITION = /^\s{0,3}\[[^\]]+\]:\s+\S/;
const SETEXT_UNDERLINE = /^\s{0,3}(=+|-+)\s*$/;
const THEMATIC_BREAK = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;

/** Build a normalized index of a Markdown source file. */
export function buildSourceIndex(lines: readonly string[]): SourceIndex {
  let text = "";
  const lineOf: number[] = [];
  let fence: { marker: string; skip: boolean } | null = null;
  let inFrontMatter = lines[0]?.trim() === "---";

  lines.forEach((raw, i) => {
    const lineNumber = i + 1;
    let visible: string;

    if (inFrontMatter) {
      // GitHub renders front matter as a table; it is not commentable text.
      if (i > 0 && raw.trim() === "---") inFrontMatter = false;
      return;
    }

    const fenceMatch = FENCE.exec(raw);
    if (fence) {
      if (fenceMatch && fenceMatch[1]!.startsWith(fence.marker[0]!) && fenceMatch[1]!.length >= fence.marker.length && !fenceMatch[2]) {
        fence = null;
        return;
      }
      if (fence.skip) return;
      visible = raw; // Code is shown literally.
    } else if (fenceMatch) {
      fence = { marker: fenceMatch[1]!, skip: DIAGRAM_LANGUAGES.has((fenceMatch[2] ?? "").toLowerCase()) };
      return;
    } else if (TABLE_DIVIDER.test(raw) && raw.includes("-") && raw.includes("|")) {
      return;
    } else if (REFERENCE_DEFINITION.test(raw) || SETEXT_UNDERLINE.test(raw) || THEMATIC_BREAK.test(raw)) {
      return;
    } else {
      visible = stripMarkdownLine(raw);
    }

    for (const ch of visible.normalize("NFKC")) {
      if (isIgnoredChar(ch)) continue;
      text += ch;
      for (let k = 0; k < ch.length; k++) lineOf.push(lineNumber);
    }
  });

  return { text, lineOf };
}

/** Start offsets of every (possibly overlapping) occurrence of needle. */
export function findAll(haystack: string, needle: string): number[] {
  const result: number[] = [];
  if (!needle) return result;
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at < 0) return result;
    result.push(at);
    from = at + 1;
  }
}
