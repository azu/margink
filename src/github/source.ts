import { findInJson } from "./json";
import { encodePath, type PullRef } from "./pull";
import type { FetchLike } from "./comparison";

/**
 * Read a file's source lines at a commit.
 *
 * The raw endpoint is tried first. If it is not readable (for example, the
 * redirect to the raw host is blocked), the blob page is parsed instead.
 */
export async function loadSourceLines(pull: PullRef, oid: string, path: string, fetchFn: FetchLike): Promise<string[]> {
  const base = `/${encodeURIComponent(pull.owner)}/${encodeURIComponent(pull.repo)}`;
  try {
    const res = await fetchFn(`${base}/raw/${oid}/${encodePath(path)}`, { credentials: "same-origin" });
    if (res.ok) return splitLines(await res.text());
  } catch {
    // Try the blob page.
  }
  const res = await fetchFn(`${base}/blob/${oid}/${encodePath(path)}`, { credentials: "same-origin" });
  if (!res.ok) throw new Error(`GitHub returned ${res.status} for ${path}.`);
  const lines = linesFromBlobHtml(await res.text());
  if (!lines) throw new Error(`Margink could not read the source of ${path}.`);
  return lines;
}

export function splitLines(text: string): string[] {
  const lines = text.split(/\r?\n/);
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** Find `rawLines` (or `rawBlob`) in the JSON a blob page embeds. */
export function linesFromBlobHtml(html: string): string[] | null {
  const scripts = html.matchAll(/<script[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/g);
  for (const [, body] of scripts) {
    let json: unknown;
    try {
      json = JSON.parse(body!);
    } catch {
      continue;
    }
    const found = findInJson(json, (v) => {
      const rec = v as Record<string, unknown>;
      if (Array.isArray(rec.rawLines) && rec.rawLines.every((l) => typeof l === "string")) return rec.rawLines as string[];
      if (typeof rec.rawBlob === "string") return splitLines(rec.rawBlob);
      return undefined;
    });
    if (found) return found;
  }
  return null;
}
