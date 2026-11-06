/**
 * Build the text published to GitHub: the selected words as a Markdown quote,
 * then the reviewer's comment. The quote tells GitHub readers which words in
 * the line the comment is about.
 */
export function buildCommentBody(selectedText: string, comment: string): string {
  const quoted = selectedText
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => `> ${line}`)
    .join("\n");
  const body = comment.trim();
  return quoted ? `${quoted}\n\n${body}` : body;
}

/** A comment made only of whitespace is not a comment. */
export function isBlankComment(comment: string): boolean {
  return comment.trim().length === 0;
}
