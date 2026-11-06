export interface PullRef {
  owner: string;
  repo: string;
  number: number;
}

/** Read the pull request from a github.com URL, or null on other pages. */
export function parsePullUrl(href: string): PullRef | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (url.hostname !== "github.com") return null;
  const m = /^\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:\/|$)/.exec(url.pathname);
  if (!m) return null;
  return { owner: decodeURIComponent(m[1]!), repo: decodeURIComponent(m[2]!), number: Number(m[3]) };
}

export function pullPath(pull: PullRef): string {
  return `/${encodeURIComponent(pull.owner)}/${encodeURIComponent(pull.repo)}/pull/${pull.number}`;
}

export function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}
