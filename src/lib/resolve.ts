import { findAll, type SourceIndex } from "./normalize";

export type Side = "base" | "head";

export type ResolveFailure =
  | "empty-selection"
  | "mixed-versions"
  | "not-found"
  | "ambiguous";

export type ResolveResult =
  | { ok: true; startLine: number; endLine: number }
  | { ok: false; reason: ResolveFailure };

/**
 * Map a selection on one rendered side to a source line range.
 *
 * `rendered` is the normalized text of the whole rendered file for that side,
 * and `[start, end)` is the selection inside it. The selection is matched to
 * the source by occurrence order: the k-th occurrence in the rendered text is
 * the k-th occurrence in the source. When the two sides disagree on the
 * number of occurrences, the location is reported as ambiguous instead of
 * guessed.
 */
export function resolveSelection(
  rendered: string,
  start: number,
  end: number,
  source: SourceIndex,
): ResolveResult {
  const needle = rendered.slice(start, end);
  if (!needle) return { ok: false, reason: "empty-selection" };

  const sourceHits = findAll(source.text, needle);
  if (sourceHits.length === 0) return { ok: false, reason: "not-found" };

  const renderedHits = findAll(rendered, needle);
  const k = renderedHits.indexOf(start);
  if (k < 0 || renderedHits.length !== sourceHits.length) {
    return { ok: false, reason: "ambiguous" };
  }

  const at = sourceHits[k]!;
  const startLine = source.lineOf[at]!;
  const endLine = source.lineOf[at + needle.length - 1]!;
  return { ok: true, startLine, endLine };
}

export const RESOLVE_MESSAGES: Record<ResolveFailure, string> = {
  "empty-selection": "Select some text to comment on.",
  "mixed-versions":
    "The selection mixes removed and added text. Select text from one version.",
  "not-found":
    "Margink could not find this text in the file's source. Select a different passage.",
  ambiguous:
    "This text appears more than once and Margink cannot tell which one you selected. Select a longer passage.",
};
