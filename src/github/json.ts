/** Depth-first search for the first value accepted by `match`. */
export function findInJson<T>(value: unknown, match: (v: unknown) => T | undefined, depth = 0): T | undefined {
  if (depth > 40 || value === null || typeof value !== "object") return undefined;
  const hit = match(value);
  if (hit !== undefined) return hit;
  const children = Array.isArray(value) ? value : Object.values(value as Record<string, unknown>);
  for (const child of children) {
    const found = findInJson(child, match, depth + 1);
    if (found !== undefined) return found;
  }
  return undefined;
}

export function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

export const PAGE_HEADERS = {
  Accept: "application/json",
  "X-Requested-With": "XMLHttpRequest",
  "GitHub-Verified-Fetch": "true",
} as const;
