import { findInJson, isRecord, PAGE_HEADERS } from "./json";
import { pullPath, type PullRef } from "./pull";

export interface Comparison {
  baseOid: string;
  headOid: string;
  /** Changed file paths keyed by GitHub's path digest (the `diff-<digest>` anchor). */
  pathsByDigest: Map<string, string>;
}

const OID = /^[0-9a-f]{40}([0-9a-f]{24})?$/;

/** Extract the comparison from any JSON payload GitHub embeds or returns. */
export function parseComparison(payloads: unknown[]): Comparison | null {
  let oids: { baseOid: string; headOid: string } | undefined;
  const pathsByDigest = new Map<string, string>();

  for (const payload of payloads) {
    oids ??= findInJson(payload, (v) => {
      if (!isRecord(v)) return undefined;
      const { baseOid, headOid } = v;
      if (typeof baseOid === "string" && typeof headOid === "string" && OID.test(baseOid) && OID.test(headOid)) {
        return { baseOid, headOid };
      }
      return undefined;
    });
    collectDigests(payload, pathsByDigest, 0);
  }
  return oids ? { ...oids, pathsByDigest } : null;
}

function collectDigests(value: unknown, out: Map<string, string>, depth: number): void {
  if (depth > 40 || value === null || typeof value !== "object") return;
  if (isRecord(value) && typeof value.path === "string" && typeof value.pathDigest === "string") {
    out.set(value.pathDigest, value.path);
  }
  const children = Array.isArray(value) ? value : Object.values(value);
  for (const child of children) collectDigests(child, out, depth + 1);
}

/** JSON embedded in the current page by GitHub's React views. */
export function embeddedJson(doc: Document): unknown[] {
  const result: unknown[] = [];
  doc.querySelectorAll('script[type="application/json"]').forEach((script) => {
    try {
      result.push(JSON.parse(script.textContent ?? ""));
    } catch {
      // Not JSON we can use.
    }
  });
  return result;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Load the base and head commits for the pull request. */
export async function loadComparison(pull: PullRef, doc: Document, fetchFn: FetchLike): Promise<Comparison> {
  const payloads = embeddedJson(doc);
  try {
    const res = await fetchFn(`${pullPath(pull)}/changes`, { headers: PAGE_HEADERS, credentials: "same-origin" });
    if (res.ok) payloads.unshift(await res.json());
  } catch {
    // Fall back to what the page embeds.
  }
  const comparison = parseComparison(payloads);
  if (!comparison) throw new Error("Margink could not read this pull request's commits from GitHub.");
  return comparison;
}

export async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
