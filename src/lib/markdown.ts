import DOMPurify from "dompurify";
import { Marked } from "marked";
import { DIAGRAM_ATTRIBUTE } from "./rendered";

/** Where a Markdown file lives, so its relative links and images can be resolved. */
export interface MarkdownLocation {
  owner: string;
  repo: string;
  /** The commit the source was read at. */
  oid: string;
  /** The file's path in the repository. */
  path: string;
}

// GitHub Flavored Markdown: tables, strikethrough, task lists, and autolinks.
const marked = new Marked({ gfm: true, breaks: false, async: false });

/**
 * Render Markdown source to a sanitized fragment, for files whose rich diff
 * GitHub does not show. Raw HTML in the source is kept the way GitHub keeps
 * it, through a sanitizer that removes scripts, event handlers, and other
 * active content, because the fragment is inserted into the github.com page.
 * Relative links and images point to the same commit on GitHub.
 */
export function renderMarkdown(source: string, location: MarkdownLocation, doc: Document): DocumentFragment {
  const html = marked.parse(source) as string;
  const purify = DOMPurify(doc.defaultView as unknown as Window & typeof globalThis);
  const fragment = purify.sanitize(html, {
    RETURN_DOM_FRAGMENT: true,
    FORBID_TAGS: ["style", "form", "button", "textarea", "select"],
    FORBID_ATTR: ["style", "id", "name"],
  }) as DocumentFragment;
  // Only the task list checkboxes GitHub renders are kept, and they stay read-only.
  for (const input of fragment.querySelectorAll("input")) {
    if (input.type !== "checkbox") input.remove();
    else input.disabled = true;
  }
  // GitHub draws these fences as diagrams, so their source text is not matched.
  for (const code of fragment.querySelectorAll("pre > code[class*='language-']")) {
    if (/\blanguage-(mermaid|geojson|topojson|stl)\b/.test(code.className)) code.parentElement!.setAttribute(DIAGRAM_ATTRIBUTE, "");
  }
  for (const a of fragment.querySelectorAll<HTMLAnchorElement>("a[href]")) {
    const href = resolveRepoUrl(a.getAttribute("href")!, location, "blob");
    if (href === null) a.removeAttribute("href");
    else a.setAttribute("href", href);
    if (href && !href.startsWith("#")) a.setAttribute("rel", "nofollow noopener noreferrer");
  }
  for (const img of fragment.querySelectorAll<HTMLImageElement>("img[src]")) {
    const src = resolveRepoUrl(img.getAttribute("src")!, location, "raw");
    if (src === null) img.removeAttribute("src");
    else img.setAttribute("src", src);
  }
  return fragment;
}

/**
 * Resolve a link or image URL written in a Markdown file. Absolute URLs and
 * fragment links are returned unchanged; a relative URL is resolved against
 * the file's directory at the same commit.
 */
export function resolveRepoUrl(url: string, location: MarkdownLocation, kind: "blob" | "raw"): string | null {
  const trimmed = url.trim();
  if (!trimmed || trimmed.startsWith("#")) return trimmed || null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed) || trimmed.startsWith("//")) return trimmed;
  const base = `https://github.com/${encodeURIComponent(location.owner)}/${encodeURIComponent(location.repo)}/${kind}/${location.oid}/`;
  // A leading slash is relative to the repository root, as on GitHub.
  const fromRoot = trimmed.startsWith("/");
  const dir = fromRoot ? "" : location.path.slice(0, location.path.lastIndexOf("/") + 1);
  const resolved = new URL((fromRoot ? trimmed.slice(1) : dir.split("/").map(encodeURIComponent).join("/") + trimmed), base);
  if (!resolved.href.startsWith(base)) return null; // `..` above the repository root.
  return resolved.pathname + resolved.search + resolved.hash;
}
